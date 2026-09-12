/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The deploy-phase analogue of "does the project build": does the generated infrastructure
 * actually compile, and does the agent's own report of that match what the compiler says.
 *
 * ## Why the exit code is not the check
 *
 * `az bicep build` is a poor pass/fail oracle, and it fails in exactly the direction that
 * matters here. Measured against bicep 0.46.1, every one of these exits **0**:
 *
 *   | injected defect                                  | exit | diagnostic      |
 *   | ------------------------------------------------ | ---- | --------------- |
 *   | resource type that does not exist                | 0    | BCP081 warning  |
 *   | API version that does not exist                  | 0    | BCP081 warning  |
 *   | required property omitted                        | 0    | BCP035 warning  |
 *   | property given the wrong type                    | 0/1  | BCP036 warn/err |
 *
 * BCP081 is in that table but is **not** blocking, for a reason measured below.
 *
 * BCP036's severity is context-dependent, which is why it carries two exit codes. Re-measured
 * on 0.46.1: given a *known* resource type, `name: 123` is `Error BCP036` and exits 1. It
 * degrades to a warning — and to exit 0 — where the type could not be resolved, because bicep
 * cannot prove the property is wrong. The blocking rule below is deliberately indifferent to
 * that distinction: BCP036 blocks either way, so the grader's verdict does not depend on
 * which side of the context split a given template lands on. Do not "simplify" the rule to
 * trust severity or the exit code; the exit-0 branch is the one that matters.
 *
 * Symbol and syntax errors (BCP057 and friends) always reach exit 1. The exit-0 rows above are
 * the generative failure modes — a model inventing a plausible resource type or a plausible API
 * version, or dropping a required property — so a grader that trusts the exit code is blind
 * precisely where the agent is weakest, and would certify hallucinated infrastructure as valid.
 *
 * This mattered beyond the grader: the scaffold agent used to be told to make the same
 * mistake. `azure-deploy/scaffold/references/validation-and-manifest.md` step 11a said
 * "Pass: exit 0", so an agent that omitted a required `sku`, read exit 0 and wrote
 * `{"name": "bicep build", "passed": true}` into `scaffold-manifest.json` had followed its
 * instructions correctly and still shipped IaC that cannot deploy. Step 11a now carries the
 * same blocking rule as this module, so the instructions and this grader agree. The self-report
 * is still evidence about the agent, not a substitute for compiling — which is why
 * `selfReportContradictsCompiler` is the single most valuable code in this module.
 *
 * ## The blocking rule
 *
 * **Errors block. `BCP*` warnings block, except `BCP081`. Linter warnings do not.**
 *
 * Bicep emits two kinds of warning under different code namespaces: type-system findings
 * (`BCP035`, `BCP036`, `BCP081`) describe a template that will not do what it says, while
 * linter findings (`no-unused-params`, `prefer-interpolation`) are style. Splitting on the
 * namespace keeps the rule to one sentence a reviewer can check against the output, and it
 * degrades safely — a new type-system code is blocking the day it ships, without an
 * allow-list anyone has to remember to update. `gates.yaml` argues the same point about
 * allow-lists decaying into silently-unwired gates.
 *
 * ## Why BCP081 is carved out
 *
 * BCP081 used to block, on the theory that it catches an invented resource type. Run
 * `2026082775134461` disproved that. The agent emitted `Microsoft.Web/sites@2026-07-15` and
 * `Microsoft.OperationalInsights/workspaces@2026-03-01`; the grader failed the run; both are
 * real, and each was the *newest* API version in the live provider registry. What actually
 * happened is that bicep ships a bundled type index that lags ARM, so BCP081 fires on any
 * API version newer than the pinned bicep build. Measured on 0.46.1:
 *
 *   | template                                | BCP081? | actually valid? |
 *   | --------------------------------------- | ------- | --------------- |
 *   | `Microsoft.Web/sites@2023-12-01`        | no      | yes             |
 *   | `Microsoft.Web/sites@2026-07-15`        | **yes** | **yes**         |
 *   | `Microsoft.Web/sites@2099-01-01`        | yes     | no              |
 *   | `Microsoft.Fake/widgets@2024-03-01`     | yes     | no              |
 *
 * Rows 2, 3 and 4 produce byte-identical diagnostics, so BCP081 cannot separate "invented"
 * from "newer than my index" — the distinction the blocking rule depended on does not exist
 * in the signal. Blocking it therefore scored agents on how *stale* their API versions were
 * and penalised the ones that were current, which is the opposite of the behaviour this
 * eval is meant to reward. A grader that pushes the product the wrong way is worse than no
 * grader, so BCP081 is advisory by default.
 *
 * Separating the two would need the live registry (`az provider show`), which needs ARM
 * credentials the eval container does not have, or a checked-in snapshot of valid
 * type/version pairs, which reintroduces the same staleness bug on a slower clock. Until one
 * of those is worth its cost, `--strict-types` restores the old behaviour for a caller who
 * knows their bicep is current, and the advisory line keeps BCP081 visible in stderr either
 * way. BCP035 and BCP036 are unaffected: both are exit-0 defects, and neither depends on the
 * type index being up to date.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { type ArtifactValidationIssue, type ArtifactValidationResult, createValidationResult } from './validationTypes.ts';

/** Codes whose verdict is "we could not look", not "the agent did badly". */
export const IAC_NOT_APPLICABLE_CODES: Record<string, 'outOfScope' | 'coverageGap'> = {
    // A project with no IaC at all is not a project this gate has a question about.
    noIacFound: 'outOfScope',
    // Terraform is a real deploy story we have simply not written a validator for. Reporting
    // it as a pass would make this gate silently approve every Terraform project.
    terraformNotSupported: 'coverageGap',
};

export interface BicepDiagnostic {
    file: string;
    line: number;
    column: number;
    severity: 'Error' | 'Warning' | 'Info';
    /** `BCP081`, or a linter rule name like `no-unused-params`. */
    code: string;
    message: string;
}

/**
 * `<path>(<line>,<col>) : <Severity> <code>: <message>`, optionally behind the `ERROR: ` /
 * `WARNING: ` prefix the az CLI adds when it relays the compiler's stderr.
 *
 * Anchored on the `(line,col) :` shape rather than the prefix, because the same diagnostic
 * reaches us with or without it depending on whether bicep is invoked through az.
 */
const DIAGNOSTIC_PATTERN = /^(?:(?:ERROR|WARNING|INFO):\s*)?(.*?)\((\d+),(\d+)\)\s*:\s*(Error|Warning|Info)\s+([^\s:]+)\s*:\s*(.*)$/;

export function parseBicepDiagnostics(output: string): BicepDiagnostic[] {
    const diagnostics: BicepDiagnostic[] = [];
    for (const raw of output.split(/\r?\n/)) {
        const match = DIAGNOSTIC_PATTERN.exec(raw.trim());
        if (!match) {
            continue;
        }
        diagnostics.push({
            file: match[1].trim(),
            line: Number(match[2]),
            column: Number(match[3]),
            severity: match[4] as BicepDiagnostic['severity'],
            code: match[5],
            // The docs URL bicep appends is noise in a failure message; the code is the link.
            message: match[6].replace(/\s*\[https?:\/\/\S+\]\s*$/, '').trim(),
        });
    }
    return diagnostics;
}

/** BCP081 is its own class: the compiler is saying it could not check this resource at all. */
export function isUnverifiableTypeDiagnostic(diagnostic: BicepDiagnostic): boolean {
    return diagnostic.code === 'BCP081';
}

export interface BlockingOptions {
    /**
     * Restore BCP081 to blocking. Only sound when the bicep build is known to be at least as
     * current as the API versions under test; see the header for why that is not the default.
     */
    strictTypes?: boolean;
}

export function isBlockingDiagnostic(diagnostic: BicepDiagnostic, options: BlockingOptions = {}): boolean {
    if (diagnostic.severity === 'Error') {
        return true;
    }
    if (diagnostic.severity !== 'Warning') {
        return false;
    }
    if (!options.strictTypes && isUnverifiableTypeDiagnostic(diagnostic)) {
        return false;
    }
    // Type-system warnings block; linter rules do not. See the header for why this splits on
    // the code namespace instead of an enumerated list.
    return /^BCP\d+$/.test(diagnostic.code);
}

export interface BicepCompileOutcome {
    blocking: BicepDiagnostic[];
    advisory: BicepDiagnostic[];
    /** True when the compiler is happy enough that the template should deploy. */
    compiled: boolean;
}

/**
 * `status` is the process exit code. It is folded in rather than trusted: a non-zero exit
 * with no parsed diagnostic still has to fail, or a future output format silently passes
 * everything.
 */
export function classifyBicepOutput(output: string, status: number | null, options: BlockingOptions = {}): BicepCompileOutcome {
    const diagnostics = parseBicepDiagnostics(output);
    const blocking = diagnostics.filter(diagnostic => isBlockingDiagnostic(diagnostic, options));
    const advisory = diagnostics.filter(diagnostic => !isBlockingDiagnostic(diagnostic, options));
    return {
        blocking,
        advisory,
        compiled: blocking.length === 0 && status === 0,
    };
}

export function describeDiagnostic(diagnostic: BicepDiagnostic): string {
    const file = path.basename(diagnostic.file) || diagnostic.file;
    return `${file}(${diagnostic.line},${diagnostic.column}) ${diagnostic.code}: ${diagnostic.message}`;
}

/**
 * ## Suppression directives
 *
 * Bicep lets a template silence a diagnostic with `#disable-next-line <code>`, and that
 * silence is indistinguishable from a clean compile. Measured on 0.46.1: `#disable-next-line
 * BCP035` above a resource missing its required `sku` and `kind` emits nothing and exits 0,
 * so without this check the single most valuable claim this gate makes — "the template
 * compiles" — is defeatable by one comment.
 *
 * That is not hypothetical here, because the agent under test has been taught the syntax:
 * `azure-deploy/references/bicep-patterns-security.md` instructs it to write
 * `#disable-next-line no-hardcoded-env-urls` for the Container Apps Key Vault URL. A
 * technique already in the agent's vocabulary is one this gate has to assume it will reach
 * for, whether or not it does so dishonestly.
 *
 * Note the asymmetry with `bicepconfig.json`, the other suppression surface, which is *not* a
 * hole in this gate. Both directions measured on 0.46.1: a config setting `BCP035` to `off`
 * still emits BCP035, because config levels apply to linter rules and cannot reach a `BCP*`
 * compiler diagnostic — while `#disable-next-line BCP035` removes it entirely. Config is
 * therefore only a concern for rules this gate does not block on today.
 */
const SUPPRESSION_DIRECTIVE = /^\s*#disable-next-line\b(.*)$/;
/** A diagnostic code or linter rule name, which excludes any `// reason` trailer. */
const SUPPRESSION_CODE = /^[A-Za-z][\w-]*$/;

export interface SuppressionDirective {
    file: string;
    line: number;
    codes: string[];
}

export function parseSuppressionDirectives(file: string, content: string): SuppressionDirective[] {
    const found: SuppressionDirective[] = [];
    content.split(/\r?\n/).forEach((raw, index) => {
        const match = SUPPRESSION_DIRECTIVE.exec(raw);
        if (!match) {
            return;
        }
        const codes = match[1]
            .replace(/\/\/.*$/, '')
            .split(/\s+/)
            .filter(token => SUPPRESSION_CODE.test(token));
        if (codes.length > 0) {
            found.push({ file, line: index + 1, codes });
        }
    });
    return found;
}

/**
 * Whether silencing `code` would hide something this gate blocks on.
 *
 * Derived from `isBlockingDiagnostic` rather than an enumerated list, so the two cannot
 * drift: the day a rule becomes blocking, suppressing it becomes a finding, with no second
 * place anyone has to remember to update. It also means the one suppression the product
 * sanctions — `no-hardcoded-env-urls`, a linter rule this gate does not block on — is allowed
 * without an allow-list to maintain, and would stop being allowed the moment that rule
 * started blocking. `gates.yaml` makes the same argument about allow-lists decaying.
 *
 * `Warning` is the right severity to assume for a diagnostic that never appeared: every
 * `BCP*` blocks at that severity, and anything that blocks as an Error blocks as a Warning
 * too, so the assumption can only under-report — never invent a finding.
 */
export function suppressesBlockingDiagnostic(code: string, options: BlockingOptions = {}): boolean {
    return isBlockingDiagnostic({ file: '', line: 0, column: 0, severity: 'Warning', code, message: '' }, options);
}

export function findBlockingSuppressions(directives: SuppressionDirective[], options: BlockingOptions = {}): SuppressionDirective[] {
    return directives
        .map(directive => ({ ...directive, codes: directive.codes.filter(code => suppressesBlockingDiagnostic(code, options)) }))
        .filter(directive => directive.codes.length > 0);
}

export function describeSuppression(directive: SuppressionDirective): string {
    const file = path.basename(directive.file) || directive.file;
    return `${file}(${directive.line}) suppresses ${directive.codes.join(', ')}`;
}

/**
 * Every `.bicep` under the entry point's directory. Modules are walked too, because a
 * suppression in `modules/database.bicep` hides exactly as much as one in `main.bicep` and
 * the entry point is the only file the compiler is invoked on.
 */
export async function collectBicepSources(entryPoint: string): Promise<{ file: string; content: string }[]> {
    const sources: { file: string; content: string }[] = [];
    const walk = async (dir: string): Promise<void> => {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const absolute = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(absolute);
            } else if (entry.name.endsWith('.bicep')) {
                try {
                    sources.push({ file: absolute, content: await fs.readFile(absolute, 'utf8') });
                } catch {
                    // An unreadable template is the compiler's problem to report, not this scan's.
                }
            }
        }
    };
    await walk(path.dirname(entryPoint));
    return sources;
}

// ---------------------------------------------------------------------------------------
// The offline half: everything decidable without a bicep binary.
// ---------------------------------------------------------------------------------------

export interface ScaffoldManifestCheck {
    name?: unknown;
    /** The shape `scaffold-schemas.ts` declares. */
    passed?: unknown;
    /** The shape `validation-and-manifest.md` step 11c tells the agent to write. */
    result?: unknown;
    /** Free text; the only place some agents record the command they actually ran. */
    detail?: unknown;
}

/** Names an infrastructure language, so the check is plausibly about compiling it. */
const IAC_SUBJECT = /(bicep|\biac\b|arm[\s-]*template)/i;
/** Names the act of turning that source into a template. */
const COMPILE_ACT = /(build|compil|syntax|transpil|lint|validat)/i;
/**
 * Names a *different* scaffold check that also legitimately mentions Bicep. Step 11b tells
 * the agent to "review generated Bicep for correct role assignments", so an RBAC entry can
 * easily satisfy both patterns above and be mistaken for the compilation entry.
 */
const OTHER_SCAFFOLD_TOPIC = /(rbac|role|security|secret|quota|cost|naming|tag|file)/i;

/**
 * The one check the contract requires, located the same way everywhere it is needed.
 *
 * Matching is deliberately wider than the contract's literal spelling. Step 11c shows the
 * agent `{ "name": "bicep build" }`, but that is an *example*, not a validated enum, and
 * nothing downstream of it constrains the string. Run `2026082782003660` produced:
 *
 *     { "name": "Bicep syntax validation", "passed": true,
 *       "detail": "az bicep build --file infra/main.bicep completed successfully" }
 *
 * — an agent that ran the required command, recorded it truthfully, and produced Bicep the
 * compiler then confirmed was valid. An exact-spelling matcher failed that run for
 * `missingBicepBuildCheck`. This gate claims to measure "compiles, and was reported
 * honestly"; failing an honest agent over a synonym measures neither, and teaches string
 * mimicry rather than working infrastructure. Same defect class as the BCP081 carve-out
 * above: a check that looks strict while scoring something other than what it names.
 *
 * Tiers, most to least certain, so a literal match is never displaced by a fuzzy one:
 *   1. the contract's literal spelling;
 *   2. an IaC subject plus a compile verb in the name ("Bicep syntax validation");
 *   3. an uninformative name whose detail records the command itself.
 */
export function findBicepBuildCheck(checks: unknown): ScaffoldManifestCheck | undefined {
    if (!Array.isArray(checks)) {
        return undefined;
    }
    const named = (checks as ScaffoldManifestCheck[]).filter(
        (check): check is ScaffoldManifestCheck => typeof check?.name === 'string');

    const literal = named.find(check => /bicep\s*build/i.test(check.name as string));
    if (literal) {
        return literal;
    }

    const semantic = named.find(check => {
        const name = check.name as string;
        return IAC_SUBJECT.test(name) && COMPILE_ACT.test(name) && !OTHER_SCAFFOLD_TOPIC.test(name);
    });
    if (semantic) {
        return semantic;
    }

    return named.find(
        check => typeof check.detail === 'string' && /az\s+bicep\s+build/i.test(check.detail));
}

/**
 * The two documents that define this file disagree, so both spellings are accepted.
 *
 * `scaffold-schemas.ts` declares `ValidationCheck.passed: boolean`, while step 11c of
 * `validation-and-manifest.md` shows the agent a literal example with `"result": "PASS"`.
 * An agent can follow either document faithfully, so a grader that recognised only one
 * would report a contract ambiguity as an agent failure — the fabricated verdict this
 * harness exists to avoid. Returns undefined when the check records no verdict at all.
 */
export function checkVerdict(check: ScaffoldManifestCheck): boolean | undefined {
    if (typeof check.passed === 'boolean') {
        return check.passed;
    }
    if (typeof check.result === 'string') {
        return /^pass(ed)?$/i.test(check.result.trim());
    }
    return undefined;
}

/**
 * Did the agent claim, in its own manifest, that the build passed?
 *
 * Deliberately separate from the manifest's overall validity. The grader used to read this
 * off `ArtifactValidationResult.valid`, which is true only when *every* manifest check is
 * clean — so an unrelated defect (`status: "Partial"`, an unparseable file, no `bicep build`
 * entry) silently suppressed the contradiction verdict. That inverted the intended severity:
 * the manifests most worth distrusting were exactly the ones that got the milder message.
 *
 * Returns `undefined` when the agent made no legible claim, which is not the same as a claim
 * of failure and must not be reported as one.
 */
export async function readSelfReportedBicepBuildVerdict(workspace: string): Promise<boolean | undefined> {
    const found = discoverScaffoldManifest(workspace);
    if (!found) {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(await fs.readFile(found.absolute, 'utf8'));
    } catch {
        return undefined;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return undefined;
    }
    const validationResult = (parsed as Record<string, unknown>).validationResult;
    if (typeof validationResult !== 'object' || validationResult === null) {
        return undefined;
    }
    const bicepCheck = findBicepBuildCheck((validationResult as Record<string, unknown>).checks);
    return bicepCheck ? checkVerdict(bicepCheck) : undefined;
}

/**
 * The verdict this module exists to produce: the compiler and the agent's own report of the
 * compiler disagree, and the agent's report is the optimistic one.
 *
 * This is worth more than the compile result alone. A template that does not compile is a
 * bad run; a template that does not compile *and* is recorded as validated is a broken
 * contract, because every downstream phase trusts `validationResult` instead of recompiling.
 * `validation-and-manifest.md` step 11a is the mechanism — it tells the agent to read `az
 * bicep build`'s exit code, which is 0 for BCP035, BCP036 and BCP081 alike.
 *
 * `undefined` is not a contradiction: an agent that made no claim has not made a false one.
 */
export function selfReportContradictsCompiler(selfReportedPass: boolean | undefined, compiled: boolean): boolean {
    return selfReportedPass === true && !compiled;
}

export interface DiscoveredIac {
    /** Absolute path to the entry template, when one was found. */
    entryPoint?: string;
    /** Relative, for messages. */
    relative?: string;
    flavour: 'bicep' | 'terraform' | 'none';
}

const BICEP_ENTRY_POINTS = ['infra/main.bicep', 'main.bicep', 'infra/azuredeploy.bicep'];
const TERRAFORM_ENTRY_POINTS = ['infra/main.tf', 'main.tf'];

export function discoverIac(workspace: string): DiscoveredIac {
    for (const candidate of BICEP_ENTRY_POINTS) {
        const absolute = path.join(workspace, ...candidate.split('/'));
        if (existsSync(absolute)) {
            return { entryPoint: absolute, relative: candidate, flavour: 'bicep' };
        }
    }
    for (const candidate of TERRAFORM_ENTRY_POINTS) {
        const absolute = path.join(workspace, ...candidate.split('/'));
        if (existsSync(absolute)) {
            return { entryPoint: absolute, relative: candidate, flavour: 'terraform' };
        }
    }
    return { flavour: 'none' };
}

/**
 * Where the scaffold phase actually writes its manifest.
 *
 * Not `.azure/`. That directory belongs to the *planning* agent (`project-plan.md`,
 * `requirements.json`); the deploy agent writes into a per-run session folder, and the
 * session id is a UUID minted at runtime, so the path has to be discovered rather than
 * hardcoded. `azure-deploy/scaffold/instructions.md` line 49 is the contract:
 *
 *     Session folder: `.copilot-azure/sessions/{uuid}/` — reads `prepare-plan.json` +
 *     `context.json`, writes `scaffold-manifest.json`.
 *
 * and `subagent-validate.md` ("`scaffold-manifest.json` | Session folder") and
 * `session-protocol.md`'s artifact table say the same.
 *
 * This gate originally looked in `.azure/`, which no agent ever writes, so
 * `missingScaffoldManifest` was unconditional: under `--require-artifacts` every run failed
 * no matter how good the infrastructure was, and the self-report contradiction — the verdict
 * this module exists to produce — could never fire because it is gated on a manifest that
 * was never found. Run 2026082775134461 shows the symptom: `.azure/` contained only
 * `project-plan.md`, and the failure printed the plain "does not compile" message rather
 * than the "agent recorded PASS" one.
 *
 * Which session to read matters once a workspace holds more than one. `active-session.json`
 * is the product's own pointer to the live session (`session-protocol.md`), and old sessions
 * are explicitly read-only, so the pointer is followed first. Without it — a run that failed
 * before writing one, or a workspace assembled by hand — the newest manifest is the best
 * available guess at the run being graded.
 *
 * The alternative, taking whichever session sorts first, is worse than arbitrary here: session
 * ids are UUIDs, so the winner is effectively random, and an abandoned earlier session that
 * recorded PASS would be graded in place of the real one. (`azd-template-routing.md` does say
 * to check every session, but that is about spotting leftover files before overwriting them,
 * not about deciding which run to grade.)
 */
const SESSIONS_ROOT = '.copilot-azure/sessions';
const MANIFEST_FILENAME = 'scaffold-manifest.json';
const ACTIVE_SESSION_FILENAME = 'active-session.json';
/** For messages, when there is no concrete file to point at. */
const SCAFFOLD_MANIFEST = `${SESSIONS_ROOT}/*/${MANIFEST_FILENAME}`;

/** The session id `active-session.json` points at, if it names one usably. */
function readActiveSessionId(sessionsRoot: string): string | undefined {
    try {
        const parsed: unknown = JSON.parse(readFileSync(path.join(sessionsRoot, ACTIVE_SESSION_FILENAME), 'utf8'));
        const id = (parsed as { activeSessionId?: unknown } | null)?.activeSessionId;
        // A pointer naming a path rather than a bare id would escape the sessions directory.
        return typeof id === 'string' && id.length > 0 && !id.includes('/') && !id.includes('\\') && id !== '..'
            ? id
            : undefined;
    } catch {
        return undefined;
    }
}

function manifestIn(sessionsRoot: string, session: string): { absolute: string; relative: string } | undefined {
    const absolute = path.join(sessionsRoot, session, MANIFEST_FILENAME);
    return existsSync(absolute)
        ? { absolute, relative: `${SESSIONS_ROOT}/${session}/${MANIFEST_FILENAME}` }
        : undefined;
}

export function discoverScaffoldManifest(workspace: string): { absolute: string; relative: string } | undefined {
    const sessionsRoot = path.join(workspace, ...SESSIONS_ROOT.split('/'));
    if (!existsSync(sessionsRoot)) {
        return undefined;
    }
    let sessions: string[];
    try {
        sessions = readdirSync(sessionsRoot).sort();
    } catch {
        return undefined;
    }

    const activeId = readActiveSessionId(sessionsRoot);
    if (activeId !== undefined) {
        const active = manifestIn(sessionsRoot, activeId);
        if (active) {
            return active;
        }
        // The pointer is authoritative about which session is live, so a missing manifest
        // there is a real finding. Falling through to another session would hide it.
        return undefined;
    }

    let newest: { found: { absolute: string; relative: string }; mtimeMs: number } | undefined;
    for (const session of sessions) {
        const found = manifestIn(sessionsRoot, session);
        if (!found) {
            continue;
        }
        let mtimeMs: number;
        try {
            mtimeMs = statSync(found.absolute).mtimeMs;
        } catch {
            continue;
        }
        // `sessions` is sorted, so an mtime tie resolves by name and stays deterministic.
        if (!newest || mtimeMs > newest.mtimeMs) {
            newest = { found, mtimeMs };
        }
    }
    return newest?.found;
}

/**
 * Grades the artifacts the scaffold phase is contracted to leave behind, and the internal
 * consistency of its own validation report. Deliberately does not compile anything, so it
 * can be certified offline against fixtures the way every other validator here is.
 */
export async function validateScaffoldedIac(workspace: string, options: BlockingOptions = {}): Promise<ArtifactValidationResult> {
    const issues: ArtifactValidationIssue[] = [];
    const iac = discoverIac(workspace);

    if (iac.flavour === 'none') {
        return createValidationResult([{
            code: 'noIacFound',
            path: 'infra/main.bicep',
            message: `no infrastructure template found; looked for ${[...BICEP_ENTRY_POINTS, ...TERRAFORM_ENTRY_POINTS].join(', ')}`,
        }]);
    }
    if (iac.flavour === 'terraform') {
        return createValidationResult([{
            code: 'terraformNotSupported',
            path: iac.relative!,
            message: 'the workspace uses Terraform, and this gate can only compile Bicep',
        }]);
    }

    // Reading a template for `#disable-next-line` needs no compiler, so it lives here rather
    // than beside the compile: a fixture can reach it, which makes it certifiable against real
    // files instead of only by self-test.
    for (const directive of findBlockingSuppressions(
        (await collectBicepSources(iac.entryPoint!)).flatMap(source => parseSuppressionDirectives(source.file, source.content)),
        options,
    )) {
        issues.push({
            code: 'suppressedBlockingDiagnostic',
            path: path.relative(workspace, directive.file).split(path.sep).join('/'),
            message: `line ${directive.line} suppresses ${directive.codes.join(', ')}, which this gate blocks on, so a clean compile here proves nothing`,
        });
    }

    const found = discoverScaffoldManifest(workspace);
    let manifest: Record<string, unknown> | undefined;
    if (!found) {
        issues.push({
            code: 'missingScaffoldManifest',
            path: SCAFFOLD_MANIFEST,
            message: 'the scaffold phase must record what it generated and how it validated it',
        });
    } else {
        const raw = await fs.readFile(found.absolute, 'utf8');
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            issues.push({
                code: 'unparseableScaffoldManifest',
                path: found.relative,
                message: `is not valid JSON: ${(error as Error).message}`,
            });
        }
        // `JSON.parse` succeeds on `null`, `false`, `0` and `"text"`, none of which can carry
        // a validationResult. Testing the value's truthiness instead of its shape let those
        // through with no issues recorded at all, which `createValidationResult` then read as
        // a clean self-report — a manifest containing the four characters `null` graded better
        // than one that merely omitted a field.
        if (parsed !== undefined) {
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                issues.push({
                    code: 'unparseableScaffoldManifest',
                    path: found.relative,
                    message: `is valid JSON but not an object, so it cannot carry a validationResult (parsed as ${parsed === null ? 'null' : Array.isArray(parsed) ? 'an array' : typeof parsed})`,
                });
            } else {
                manifest = parsed as Record<string, unknown>;
            }
        }
    }

    if (manifest) {
        issues.push(...validationResultIssues(manifest));
    }
    return createValidationResult(issues);
}

/**
 * The `validationResult` block is the agent's claim that it checked its own work. An absent
 * or negative claim is a different failure from a claim that turns out to be false, and the
 * grader reports them with different codes so a run can tell "never validated" from "said it
 * validated and was wrong".
 */
export function validationResultIssues(manifest: Record<string, unknown>): ArtifactValidationIssue[] {
    const issues: ArtifactValidationIssue[] = [];
    const validation = manifest.validationResult as Record<string, unknown> | undefined;
    if (!validation || typeof validation !== 'object') {
        return [{
            code: 'missingValidationResult',
            path: `${SCAFFOLD_MANIFEST}#/validationResult`,
            message: 'the manifest must not be written before validation has run',
        }];
    }

    // "Partial" and "Failed" are both legal values in scaffold-schemas.ts, and both mean the
    // phase knows it did not finish validating. Only "Validated" is a claim to check.
    if (validation.status !== 'Validated') {
        issues.push({
            code: 'iacNotValidated',
            path: `${SCAFFOLD_MANIFEST}#/validationResult/status`,
            message: `status is ${JSON.stringify(validation.status ?? null)}, expected "Validated"`,
        });
    }

    const bicepCheck = findBicepBuildCheck(validation.checks);
    if (!bicepCheck) {
        issues.push({
            code: 'missingBicepBuildCheck',
            path: `${SCAFFOLD_MANIFEST}#/validationResult/checks`,
            message: 'no check records compiling the template; compilation is the one check the contract requires. Any check naming Bicep and a compile step counts, or one whose detail records the `az bicep build` command',
        });
        return issues;
    }

    const verdict = checkVerdict(bicepCheck);
    if (verdict === undefined) {
        issues.push({
            code: 'unreadableBicepBuildCheck',
            path: `${SCAFFOLD_MANIFEST}#/validationResult/checks`,
            message: 'the "bicep build" entry records no verdict in either the `passed` or `result` form',
        });
    } else if (!verdict) {
        issues.push({
            code: 'bicepBuildSelfReportedFailure',
            path: `${SCAFFOLD_MANIFEST}#/validationResult/checks`,
            message: 'the agent recorded "bicep build" as failed and wrote the manifest anyway',
        });
    }
    return issues;
}

// ---------------------------------------------------------------------------------------
// Self-test. The parsing and blocking rules above are the part a fixture cannot certify,
// because certification may not assume a bicep binary. Every case is a real line emitted by
// bicep 0.46.1.
// ---------------------------------------------------------------------------------------

const HALLUCINATED_TYPE = 'WARNING: /w/infra/main.bicep(6,22) : Warning BCP081: Resource type "Microsoft.Fake/widgets@2024-03-01" does not have types available. Bicep is unable to validate resource properties prior to deployment, but this will not block the resource from being deployed. [https://aka.ms/bicep/core-diagnostics#BCP081]';
const UNDEFINED_SYMBOL = 'ERROR: /w/infra/main.bicep(7,12) : Error BCP057: The name "missingParam" does not exist in the current context. [https://aka.ms/bicep/core-diagnostics#BCP057]';
const LINTER_NIT = 'WARNING: /w/infra/main.bicep(3,7) : Warning no-unused-params: Parameter "environmentName" is declared but never used. [https://aka.ms/bicep/linter-diagnostics#no-unused-params]';
const WRONG_PROPERTY_TYPE = 'WARNING: /w/infra/main.bicep(9,16) : Warning BCP036: The property "name" expected a value of type "string" but the provided value is of type "123". [https://aka.ms/bicep/core-diagnostics#BCP036]';
const CURRENT_API_VERSION = 'WARNING: /w/infra/modules/function-app.bicep(13,22) : Warning BCP081: Resource type "Microsoft.Web/sites@2026-07-15" does not have types available. Bicep is unable to validate resource properties prior to deployment, but this will not block the resource from being deployed. [https://aka.ms/bicep/core-diagnostics#BCP081]';
const MISSING_REQUIRED_PROPERTY = 'WARNING: /w/infra/main.bicep(1,10) : Warning BCP035: The specified "resource" declaration is missing the following required properties: "location". If this is a resource type definition inaccuracy, report it using https://aka.ms/bicep-type-issues.';

export const IAC_SELF_TEST_CASES: { name: string; run: () => string | undefined }[] = [
    {
        name: 'finds the bicep check under the name a real agent actually wrote',
        run: () => {
            // Verbatim from run 2026082782003660, whose Bicep the compiler confirmed valid.
            const checks = [
                {
                    name: 'Bicep syntax validation',
                    passed: true,
                    detail: 'az bicep build --file infra/main.bicep completed successfully',
                },
                { name: 'Required files present', passed: true },
                { name: 'Security patterns applied', passed: true },
            ];
            const found = findBicepBuildCheck(checks);
            if (!found) {
                return 'an honest agent was failed for missingBicepBuildCheck over a synonym';
            }
            return found.name === 'Bicep syntax validation' ? undefined : `matched ${String(found.name)}`;
        },
    },
    {
        name: 'prefers the literal spelling over a synonym',
        run: () => {
            const found = findBicepBuildCheck([
                { name: 'Bicep syntax validation', passed: false },
                { name: 'bicep build', passed: true },
            ]);
            return found?.name === 'bicep build' ? undefined : `tier 2 displaced tier 1: ${String(found?.name)}`;
        },
    },
    {
        name: 'does not mistake the step 11b RBAC review for the compile check',
        run: () => {
            // Step 11b literally says "review generated Bicep", so this names Bicep and
            // matches /validat/ — it must still not be read as the compilation verdict.
            const found = findBicepBuildCheck([
                { name: 'RBAC role validation', passed: true, detail: 'reviewed generated Bicep role assignments' },
            ]);
            return found === undefined ? undefined : `RBAC entry matched as the build check: ${String(found.name)}`;
        },
    },
    {
        name: 'falls back to the recorded command when the name is uninformative',
        run: () => {
            const found = findBicepBuildCheck([
                { name: 'Step 11a', passed: true, detail: 'ran az bicep build --file infra/main.bicep' },
            ]);
            return found?.name === 'Step 11a' ? undefined : 'detail fallback did not match';
        },
    },
    {
        name: 'still reports a manifest that records no compilation check at all',
        run: () => {
            const found = findBicepBuildCheck([
                { name: 'Required files present', passed: true },
                { name: 'Security patterns applied', passed: true },
            ]);
            return found === undefined ? undefined : `matched an unrelated check: ${String(found.name)}`;
        },
    },
    {
        name: 'parses the az-prefixed diagnostic shape',
        run: () => {
            const [diagnostic] = parseBicepDiagnostics(UNDEFINED_SYMBOL);
            if (!diagnostic) {
                return 'no diagnostic parsed';
            }
            if (diagnostic.code !== 'BCP057' || diagnostic.severity !== 'Error') {
                return `parsed ${diagnostic.severity} ${diagnostic.code}, expected Error BCP057`;
            }
            if (diagnostic.line !== 7 || diagnostic.column !== 12) {
                return `parsed position ${diagnostic.line},${diagnostic.column}, expected 7,12`;
            }
            return undefined;
        },
    },
    {
        name: 'strips the docs URL from the message',
        run: () => {
            const [diagnostic] = parseBicepDiagnostics(UNDEFINED_SYMBOL);
            return /aka\.ms/.test(diagnostic?.message ?? '') ? `message kept the URL: ${diagnostic.message}` : undefined;
        },
    },
    {
        name: 'parses a diagnostic with no az prefix',
        run: () => {
            const bare = UNDEFINED_SYMBOL.replace(/^ERROR:\s*/, '');
            return parseBicepDiagnostics(bare).length === 1 ? undefined : 'unprefixed diagnostic was not parsed';
        },
    },
    {
        name: 'ignores lines that are not diagnostics',
        run: () => {
            const noise = '{\n  "$schema": "https://schema.management.azure.com/...",\n  "contentVersion": "1.0.0.0"\n}';
            const count = parseBicepDiagnostics(noise).length;
            return count === 0 ? undefined : `parsed ${count} diagnostics out of compiler stdout`;
        },
    },
    {
        name: 'BCP081 is advisory by default, because it cannot tell invented from merely newer',
        run: () => {
            const outcome = classifyBicepOutput(HALLUCINATED_TYPE, 0);
            if (!outcome.compiled) {
                return 'BCP081 blocked by default, which fails agents for using current API versions';
            }
            return outcome.advisory.some(d => d.code === 'BCP081')
                ? undefined
                : 'BCP081 was dropped instead of being recorded as advisory';
        },
    },
    {
        // Regression test for run 2026082775134461. Microsoft.Web/sites@2026-07-15 is real and
        // was the newest version in the registry; bicep 0.46.1 still raised BCP081 on it.
        name: 'a real API version newer than the bicep type index does not fail the compile',
        run: () => classifyBicepOutput(CURRENT_API_VERSION, 0).compiled
            ? undefined
            : 'a valid, current API version was reported as a compile failure',
    },
    {
        name: 'a bad property type blocks even though bicep exits 0',
        run: () => classifyBicepOutput(WRONG_PROPERTY_TYPE, 0).compiled
            ? 'BCP036 with exit 0 was treated as a successful compile'
            : undefined,
    },
    {
        // The header's measured table claims this row; without a case it was just an assertion,
        // and the code it named (BCP333) turned out to be wrong. Pin the real one.
        name: 'a missing required property blocks even though bicep exits 0',
        run: () => {
            const outcome = classifyBicepOutput(MISSING_REQUIRED_PROPERTY, 0);
            if (outcome.compiled) {
                return 'BCP035 with exit 0 was treated as a successful compile';
            }
            return outcome.blocking[0]?.code === 'BCP035'
                ? undefined
                : `expected BCP035 to block, got ${outcome.blocking.map(d => d.code).join(',') || 'nothing'}`;
        },
    },
    {
        name: 'linter warnings are advisory, not failures',
        run: () => {
            const outcome = classifyBicepOutput(LINTER_NIT, 0);
            if (!outcome.compiled) {
                return 'a style-only linter warning failed the compile';
            }
            return outcome.advisory.length === 1 ? undefined : `linter warning was not recorded as advisory`;
        },
    },
    {
        name: 'linter warnings do not mask a real error alongside them',
        run: () => {
            const outcome = classifyBicepOutput(`${LINTER_NIT}\n${UNDEFINED_SYMBOL}`, 1);
            return outcome.blocking.length === 1 && outcome.blocking[0].code === 'BCP057'
                ? undefined
                : `expected only BCP057 to block, got ${outcome.blocking.map(d => d.code).join(',') || 'nothing'}`;
        },
    },
    {
        name: '--strict-types restores BCP081 blocking without touching BCP036',
        run: () => {
            const strict = classifyBicepOutput(HALLUCINATED_TYPE, 0, { strictTypes: true });
            if (strict.compiled) {
                return 'BCP081 stayed advisory under --strict-types';
            }
            const always = classifyBicepOutput(WRONG_PROPERTY_TYPE, 0);
            return always.compiled ? 'BCP036 must block regardless of --strict-types' : undefined;
        },
    },
    {
        name: 'a non-zero exit fails even when nothing parsed',
        run: () => classifyBicepOutput('bicep exploded in a way we do not recognise', 1).compiled
            ? 'a failing exit code with no parsed diagnostic was treated as success'
            : undefined,
    },
    {
        name: 'a clean compile passes',
        run: () => classifyBicepOutput('', 0).compiled ? undefined : 'a clean compile did not pass',
    },
    {
        name: 'a manifest written without validationResult is reported',
        run: () => {
            const codes = validationResultIssues({}).map(issue => issue.code);
            return codes.includes('missingValidationResult') ? undefined : `got ${codes.join(',') || 'nothing'}`;
        },
    },
    {
        name: 'a PASS self-report on a validated manifest is clean',
        run: () => {
            const issues = validationResultIssues({
                validationResult: { status: 'Validated', checks: [{ name: 'bicep build', result: 'PASS' }] },
            });
            return issues.length === 0 ? undefined : `expected no issues, got ${issues.map(i => i.code).join(',')}`;
        },
    },
    {
        name: 'the schema spelling `passed: true` is accepted like `result: PASS`',
        run: () => {
            const issues = validationResultIssues({
                validationResult: { status: 'Validated', checks: [{ name: 'bicep build', passed: true }] },
            });
            return issues.length === 0 ? undefined : `the documented schema shape was rejected: ${issues.map(i => i.code).join(',')}`;
        },
    },
    {
        name: 'the schema spelling `passed: false` is a self-reported failure',
        run: () => {
            const codes = validationResultIssues({
                validationResult: { status: 'Validated', checks: [{ name: 'bicep build', passed: false }] },
            }).map(issue => issue.code);
            return codes.includes('bicepBuildSelfReportedFailure') ? undefined : `got ${codes.join(',') || 'nothing'}`;
        },
    },
    {
        name: 'a check with no verdict in either spelling is reported, not assumed to pass',
        run: () => {
            const codes = validationResultIssues({
                validationResult: { status: 'Validated', checks: [{ name: 'bicep build' }] },
            }).map(issue => issue.code);
            return codes.includes('unreadableBicepBuildCheck') ? undefined : `got ${codes.join(',') || 'nothing'}`;
        },
    },
    {
        name: 'a Partial status is not treated as validated',
        run: () => {
            const codes = validationResultIssues({
                validationResult: { status: 'Partial', checks: [{ name: 'bicep build', passed: true }] },
            }).map(issue => issue.code);
            return codes.includes('iacNotValidated') ? undefined : `got ${codes.join(',') || 'nothing'}`;
        },
    },
    {
        name: 'a validationResult with no bicep build check is reported',
        run: () => {
            const codes = validationResultIssues({
                validationResult: { status: 'Validated', checks: [{ name: 'RBAC review', passed: true }] },
            }).map(issue => issue.code);
            return codes.includes('missingBicepBuildCheck') ? undefined : `got ${codes.join(',') || 'nothing'}`;
        },
    },
    {
        name: 'a manifest recording its own failed build is reported',
        run: () => {
            const codes = validationResultIssues({
                validationResult: { status: 'Validated', checks: [{ name: 'bicep build', result: 'FAIL' }] },
            }).map(issue => issue.code);
            return codes.includes('bicepBuildSelfReportedFailure') ? undefined : `got ${codes.join(',') || 'nothing'}`;
        },
    },
    {
        // The grader used to derive this from the manifest's overall validity, so any unrelated
        // defect suppressed the contradiction. `status: "Partial"` alongside a claimed-passing
        // build is the case that matters: the manifest is invalid AND lying.
        name: 'a contradiction is reported even when the manifest is also wrong in another way',
        run: () => selfReportContradictsCompiler(true, false) ? undefined : 'a false PASS over a failed compile was not called a contradiction',
    },
    {
        name: 'no legible claim is not a contradiction',
        run: () => {
            if (selfReportContradictsCompiler(undefined, false)) {
                return 'an agent that made no claim was accused of making a false one';
            }
            return selfReportContradictsCompiler(false, false) ? 'an honest self-reported failure was called a contradiction' : undefined;
        },
    },
    {
        name: 'a truthful PASS over a clean compile is not a contradiction',
        run: () => selfReportContradictsCompiler(true, true) ? 'a correct self-report was called a contradiction' : undefined,
    },
    {
        // The bypass this check exists for. Measured on 0.46.1: this exact directive above a
        // resource missing `sku` and `kind` produces no output and exit 0.
        name: 'suppressing a blocking diagnostic is reported',
        run: () => {
            const found = findBlockingSuppressions(parseSuppressionDirectives('main.bicep', 'param a string\n#disable-next-line BCP035\nresource r ...'));
            if (found.length !== 1) {
                return `expected one blocking suppression, got ${found.length}`;
            }
            return found[0].line === 2 && found[0].codes[0] === 'BCP035'
                ? undefined
                : `wrong location or code: ${describeSuppression(found[0])}`;
        },
    },
    {
        // bicep-patterns-security.md tells the agent to write exactly this. Flagging it would
        // fail an agent for following its instructions — the defect class this file's header
        // records three times over.
        name: 'the product-sanctioned no-hardcoded-env-urls suppression is allowed',
        run: () => findBlockingSuppressions(parseSuppressionDirectives('main.bicep', '#disable-next-line no-hardcoded-env-urls')).length > 0
            ? 'a suppression the product instructs the agent to write was reported as cheating'
            : undefined,
    },
    {
        name: 'suppressing BCP081 is allowed by default, because BCP081 does not block',
        run: () => findBlockingSuppressions(parseSuppressionDirectives('main.bicep', '#disable-next-line BCP081')).length > 0
            ? 'suppressing an advisory diagnostic was treated as hiding a blocking one'
            : undefined,
    },
    {
        // The drift guard: suppression-worthiness is derived from the blocking rule, so
        // --strict-types has to move both together or the derivation is not real.
        name: 'suppressing BCP081 is reported under --strict-types',
        run: () => findBlockingSuppressions(parseSuppressionDirectives('main.bicep', '#disable-next-line BCP081'), { strictTypes: true }).length === 1
            ? undefined
            : 'suppression tracking did not follow the blocking rule when BCP081 became blocking',
    },
    {
        name: 'a directive mixing blocking and allowed codes reports only the blocking one',
        run: () => {
            const found = findBlockingSuppressions(parseSuppressionDirectives('main.bicep', '#disable-next-line no-unused-params BCP036'));
            return found.length === 1 && found[0].codes.length === 1 && found[0].codes[0] === 'BCP036'
                ? undefined
                : `expected only BCP036, got ${JSON.stringify(found.map(f => f.codes))}`;
        },
    },
    {
        name: 'a trailing // reason is not parsed as a suppressed code',
        run: () => {
            const parsed = parseSuppressionDirectives('main.bicep', '#disable-next-line BCP035 // sku is set by the module');
            return parsed.length === 1 && parsed[0].codes.length === 1 && parsed[0].codes[0] === 'BCP035'
                ? undefined
                : `reason text leaked into the code list: ${JSON.stringify(parsed[0]?.codes)}`;
        },
    },
    {
        name: 'a template with no directives yields no suppressions',
        run: () => parseSuppressionDirectives('main.bicep', 'param location string = "eastus"\nresource r ...').length > 0
            ? 'a template with no #disable-next-line was reported as suppressing something'
            : undefined,
    },
];

/** Returns the number of failures, printing each. Mirrors `selfTestDeclaredGaps`. */
export function selfTestIacCompiles(report: (line: string) => void): number {
    let failures = 0;
    for (const testCase of IAC_SELF_TEST_CASES) {
        const failure = testCase.run();
        if (failure) {
            failures++;
            report(`  ✗ ${testCase.name}: ${failure}`);
        }
    }
    report(`  iac-compiles self-test: ${IAC_SELF_TEST_CASES.length - failures}/${IAC_SELF_TEST_CASES.length} cases passed`);
    return failures;
}
