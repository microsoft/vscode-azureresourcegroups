#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Audits the evaluation instrument rather than the product.
 *
 * A gate that has never once passed is far more likely to be broken than the product is to be
 * uniformly incapable of exactly that one thing. In the suite this idea comes from, the `worker`
 * gate recorded 16 failures and zero passes across every run ever executed before anyone noticed
 * that the storage probe signed its Azurite requests with a corrupted account key — Azurite
 * answered 403 to every request, so no generated app could have passed regardless of quality.
 * Ten percent of the corpus was being charged for a harness defect.
 *
 * Four signals matter, and each maps to a distinct instrument failure:
 *   never-passed    — the gate may be impossible to satisfy (broken probe, wrong credential, bad fixture)
 *   never-failed    — the gate may be vacuous; it has never discriminated between good and bad output
 *   always-n/a      — the gate is dead weight; no scenario has ever exercised it
 *   never-attempted — the gate never got the chance to run; this indicts everything upstream of it
 *
 * None of these are proof of a defect. All of them are reasons to go look before quoting a score.
 *
 * ## What is different here, and why
 *
 * The original reads `cor-validation.json` files emitted by an SDK-driven runner that recorded a
 * per-gate `status` and a `notAttempted` flag. **No such file exists in this world.** MSBench
 * records only `passed: true | false` plus a nullable `error`, so every distinction above has to be
 * reconstructed from four inputs (see `readInstance`). Two consequences are worth stating up front.
 *
 * **1. Cascade is per-instance here, not per-gate — and it corrupts the tally in both directions.**
 *
 * The original matched cascade on the prose of a gate's failure reason. Ours is structured and
 * coarser: `error.json` marks a whole instance void (`RATE_LIMIT`, `X_EXTENSION_ACTIVATION_ERROR`,
 * `X_MODEL_NOT_FOUND_ERROR`, `X_ASSERTION_DOES_NOT_COMPILE`). Every verdict in a void instance is
 * discarded — **including the passes**, which is the part the original does not model.
 *
 * That is not a theoretical refinement. Run `2026082583236973` was rate limited, the agent produced
 * literally nothing, and the gate `Agent should not fall back to the chat question tool` is recorded
 * as **passing** — because a negative assertion (`COUNT(*) = 0`) is trivially true against an empty
 * table. Run `2026082467189297` died in extension activation and scored 4/7, where all four "passes"
 * are the negative assertions and all three "failures" are just the extension never starting. A
 * naive pass rate over those runs manufactures failures the product never earned *and* credits
 * passes it never earned. Six of twenty-six instances in the current corpus are void.
 *
 * The liveness sentinel (PR #1706) prevents this going forward by failing such runs outright. It
 * does nothing for the runs already recorded, which is why this tool still has to discard them.
 *
 * **2. Gate identity is the comment string, and it does not survive editing.**
 *
 * MSBench carries no gate id — `eval.json` identifies an assertion only by its human comment. So
 * `requirements.json should be valid JSON carrying a questions array` and `requirements.json
 * satisfies the requirements contract` are the same gate before and after it moved from a SQL
 * assertion to an `exec:` grader, and are counted here as two gates with 7 and 3 runs rather than
 * one with 10. **A gate can silently reset its own history by being reworded.** The fix is a stable
 * `gate=<id>` token on every verdict line (see `NOT_APPLICABLE_MARKER`); until stimuli are
 * retrofitted, identity is best-effort and `--min-runs` is doing real work.
 *
 * Runs straight off source via Node's built-in type stripping — no build step.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Shared with `regrade.ts` on purpose. Both tools want the same extraction of the same run, so a
 * run pulled by either is already on disk for the other. Gitignored.
 */
const CACHE_ROOT = join(HERE, '.regrade');

/** Today's declared gates, used only to spot ones no run has ever exercised. Never written to. */
const STIMULI_DIR = join(HERE, 'config', 'stimuli');

/**
 * Mirrors `graderHarness.ts`. Exit 3 means the grader itself broke — it is not a verdict about the
 * product, so it can neither pass nor fail a gate.
 */
const EXIT_GRADER_ERROR = 3;

/**
 * The structured not-applicable marker, agreed with the fidelity-gates and runtime-gates sessions:
 *
 *   NOT_APPLICABLE gate=<gate-id> class=<outOfScope|environmentGap> reason=<reasonCode> detail="…"
 *
 * `class=` is the mechanical split this tool asked for, and it is on the line rather than in a
 * lookup table here so that a new reason code cannot silently default into the wrong bucket. Each
 * gate family owns its own reason-to-class mapping, so adding a reason is never a shared edit:
 *
 *   outOfScope     — the gate should not have been wired to this stack (`noFrontendDeclared`).
 *                    Applicability is a wiring-time decision, so this is a config bug with an
 *                    owner rather than proof the gate is unnecessary.
 *   environmentGap — the gate applies, the machine cannot run it (`functionsHostUnavailable`,
 *                    `ecosystemNotSupported`). Not dead weight: nobody has decided this gate is
 *                    unnecessary. Tallied with cascade, because that is what it is.
 *
 * `ecosystemNotSupported` sits on the environmentGap side, which is the instructive case: a Go
 * project has a plan, a tree and a real fidelity question — there is simply no analyser for it.
 * Bucketed as dead weight it would suggest deleting the gate when the correct action is to write
 * the analyser. That judgement belongs to the producer, which is why this tool buckets on `class=`
 * alone and never interprets reason codes. A missing or unrecognised `class=` is read as
 * `environmentGap`, the safe direction: it says "something is in the way" rather than "this gate
 * should not be here".
 *
 * Note what does **not** belong here at all: a reason meaning "we tried and it did not work" is a
 * product failure and must go red. Routing one through the N/A path turns a real bug into a
 * self-suppressing green.
 *
 * ## Why this detection matters, and why it survived the convention changing
 *
 * An N/A grader **exits 3**, and MSBench records that as `passed: false`. So an N/A is scored as a
 * **failure**, and a gate that is not applicable across the whole corpus reads 0-for-16 — which is
 * this file's opening story exactly, except the gate is fine and the environment is the problem.
 *
 * It was very nearly the opposite. Exit 0 was ruled first, on the explicit grounds that this tool's
 * always-not-applicable verdict made it safe. That premise was wrong: MSBench writes `exitCode = 0`
 * as `passed: true`, `resolved` derives from it, and the run-analysis site, `msbench-cli report` and
 * Kusto all publish that number. This report could say "not applicable" while the headline said
 * green, and **nobody investigates green**. Observing inflation is not the same as undoing it. The
 * ruling was reversed on that basis: exit 3 is pessimistic and recoverable, exit 0 was optimistic
 * and unrecoverable.
 *
 * The contract, which is deliberately stated as a contract and not a preference:
 *
 *   1. N/A is its own bucket, alongside passed / failed / notAttempted. It is never folded into
 *      `passed` **and never into `failed`** — under exit 3 the second is the live risk, and it
 *      would charge the product for a missing binary.
 *   2. Every rate excludes N/A from **both** numerator and denominator. A gate that ran 16 times,
 *      was N/A 16 times and passed 0 real times has no pass rate — it has *no applicable
 *      observations*. See `passRate`, which returns undefined rather than 0%.
 *   3. Always-N/A gates are grouped by reason code. Under exit 3 this is what separates "five gates
 *      are broken" from "one binary is missing, here is the install command".
 *
 * Detection keys off **the marker, not the exit code** — which is why the reversal from exit 0 to
 * exit 3 required no change to any of it. That ordering matters in one specific way: the marker is
 * checked *before* the exit-3 grader-error branch, so a legitimately-crashed grader (exit 3, no
 * marker) stays distinct from a not-applicable one.
 */
const NOT_APPLICABLE_MARKER = /^NOT_APPLICABLE\b([^\n]*)/mu;

/**
 * `key=value` on the marker line. Parsed order-independently rather than as one fixed-order regex:
 * the token order is not part of the agreed contract, and a producer reordering them must not
 * silently turn every N/A back into a pass.
 */
const MARKER_TOKEN = /\b(gate|class|reason)=("[^"]*"|\S+)/gu;

/**
 * `gate=<id>` on a `PASS:` / `FAIL:` / `NOT_APPLICABLE` line. Fidelity derives the id from the
 * grader's filename, which is also the certification manifest's validator id — so it doubles as a
 * join key to the grader-certification reports under `evals/results/grader-certification/`.
 */
const GATE_ID = /^(?:PASS|FAIL|NOT_APPLICABLE)\b[^\n]*?\bgate=(\S+)/mu;

/**
 * Below this many runs a verdict is a coincidence with a label on it. Verdicts are still printed,
 * but marked low-confidence and never used to fail the process.
 */
const DEFAULT_MIN_RUNS = 3;

type Verdict = 'never-passed' | 'never-failed' | 'always-not-applicable' | 'never-attempted' | 'healthy';

interface GateTally {
    passed: number;
    /** Failures where the gate actually ran and rendered a verdict about the product. */
    failed: number;
    /** "Failures" that are really upstream cascade, a void instance, or a broken grader. */
    notAttempted: number;
    notApplicable: number;
    /** Distinct runs, and distinct instances — a 5-instance run is one run but five observations. */
    runs: Set<string>;
    instances: number;
    exampleFailure?: string;
    exampleFailureRun?: string;
    /** Why the gate did not run, counted by cause, so the report groups rather than just totals. */
    notAttemptedReasons: Map<string, number>;
    /** Why the gate was inapplicable, counted by reason code. */
    notApplicableReasons: Map<string, number>;
}

interface GateRow {
    gate: string;
    tally: GateTally;
    verdict: Verdict;
    confident: boolean;
}

interface Options {
    runIds: string[];
    extractedDirs: string[];
    minRuns: number;
    json: boolean;
    refresh: boolean;
    /** `false` keys gates by grader id where available; `true` keys by the raw assertion comment. */
    identityByComment: boolean;
}

class GateHealthError extends Error { }

let jsonMode = false;
function log(message: string): void {
    if (jsonMode) {
        console.error(message);
    } else {
        console.log(message);
    }
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const USAGE = `Audit the gates themselves across past MSBench runs. Costs zero tokens.

Usage:
  node gate-health.ts [run-id...] [options]

With no run ids, every run in the local MSBench cache is audited. Run ids that are not
cached are fetched with \`msbench-cli extract\`, which is server-backed — so any run id
you have access to works from any machine, not just the one that submitted it.

Options:
  --extracted <dir>   Audit an existing extraction directory. Repeatable.
  --min-runs <n>      Runs required before a verdict is treated as confident (default ${DEFAULT_MIN_RUNS}).
  --identity <mode>   'gate' (default) keys gates by grader id, so rewording an assertion does not
                      start a fresh history; 'comment' keys by the raw assertion comment.
  --refresh           Re-extract even when the cache already has the run.
  --json              Machine-readable report on stdout.
  -h, --help          This message.

Exit codes:
  0  no confident never-passed gate
  1  at least one gate ran often enough to judge and never once passed
`;

function parseArgs(argv: string[]): Options {
    const options: Options = {
        runIds: [],
        extractedDirs: [],
        minRuns: DEFAULT_MIN_RUNS,
        json: false,
        refresh: false,
        identityByComment: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        switch (arg) {
            case '-h':
            case '--help':
                console.log(USAGE);
                process.exit(0);
                break;
            case '--json':
                options.json = true;
                break;
            case '--refresh':
                options.refresh = true;
                break;
            case '--identity': {
                const value = argv[++index];
                if (value !== 'gate' && value !== 'comment') {
                    throw new GateHealthError("--identity takes 'gate' or 'comment'");
                }
                options.identityByComment = value === 'comment';
                break;
            }
            case '--extracted': {
                const value = argv[++index];
                if (!value) {
                    throw new GateHealthError('--extracted needs a directory');
                }
                options.extractedDirs.push(resolve(value));
                break;
            }
            case '--min-runs': {
                const value = Number(argv[++index]);
                if (!Number.isInteger(value) || value < 1) {
                    throw new GateHealthError('--min-runs needs a positive integer');
                }
                options.minRuns = value;
                break;
            }
            default:
                if (arg.startsWith('-')) {
                    throw new GateHealthError(`Unknown option ${arg}`);
                }
                options.runIds.push(arg);
        }
    }
    return options;
}

// ---------------------------------------------------------------------------
// Locating runs
// ---------------------------------------------------------------------------

/** Candidate locations of MSBench's per-machine run cache. */
function msbenchRunRoots(): string[] {
    return [
        process.env.MSBENCH_DATA_DIR ? join(process.env.MSBENCH_DATA_DIR, 'runs') : undefined,
        join(homedir(), 'Library', 'Application Support', 'msbench', 'runs'),
        join(homedir(), '.local', 'share', 'msbench', 'runs'),
        process.env.APPDATA ? join(process.env.APPDATA, 'msbench', 'runs') : undefined,
    ].filter((path): path is string => path !== undefined);
}

/**
 * MSBench's own run cache. This is where run *discovery* is local-only: the CLI can list runs from
 * Kusto (`list runs --kusto`), but that needs a Kusto read grant the `MSBench User` role does not
 * include, so without explicit run ids all we can enumerate is this machine's history. The run
 * *data* is not local — see `extractRun`.
 */
function localRunIds(): string[] {
    for (const root of msbenchRunRoots()) {
        if (!existsSync(root)) {
            continue;
        }
        const ids = readdirSync(root, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && /^\d+$/u.test(entry.name))
            .map(entry => entry.name)
            .sort();
        if (ids.length > 0) {
            return ids;
        }
    }
    return [];
}

/**
 * Extraction is served by the MSBench backend, not by the local cache — extracting an unknown id
 * reports `Requesting run metadata from remote service`. A cached `results.zip` is unzipped without
 * a network call, so re-auditing the same corpus stays fast and offline.
 */
function extractRun(runId: string, refresh: boolean): string | undefined {
    const dir = join(CACHE_ROOT, runId);
    if (!refresh && findInstances(dir).length > 0) {
        return dir;
    }

    const result = spawnSync('msbench-cli', ['extract', '--run_id', runId, '--output', dir], {
        encoding: 'utf8',
    });
    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new GateHealthError(
            'msbench-cli is not on PATH. Run:\n' +
            '  export PATH="$HOME/.msbench-venv/bin:$PATH"\n' +
            'Invoking it by absolute path breaks its plugin discovery, so it has to be on PATH.'
        );
    }
    if (result.status !== 0) {
        log(`  ! ${runId}: extract failed, skipping (${(result.stderr ?? '').trim().split('\n').pop() ?? 'no detail'})`);
        return undefined;
    }
    return dir;
}

interface Instance {
    name: string;
    vscOutput: string;
    outputDir: string;
}

/** One `<instance>-output/output/vsc-output` tree per instance, as `regrade.ts` finds them. */
function findInstances(root: string): Instance[] {
    if (!existsSync(root)) {
        return [];
    }
    // A total scan, deliberately: no first-match, no break, no index assumption. Directory order
    // from readdirSync is not guaranteed, so anything order-sensitive here would drop instances
    // non-deterministically — and it would fail towards "never executed", this tool's loudest
    // verdict. `diagnoseEmptyExtraction` is the paired check for the same hazard.
    return readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name.endsWith('-output'))
        .map(entry => ({
            name: entry.name.replace(/-output$/u, ''),
            outputDir: join(root, entry.name, 'output'),
            vscOutput: join(root, entry.name, 'output', 'vsc-output'),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * An extraction with no instances has two very different causes, and collapsing them is the same
 * "passes for the wrong reason" shape this tool exists to find — pointed at the tool itself.
 *
 *   - The run's archive contains instance output we failed to load. That is a **reader fault**, and
 *     it must be loud: a corpus consumer that silently drops runs under-reports gate coverage
 *     invisibly, and it fails towards "never executed".
 *   - The archive genuinely has no instance output yet. That is a corpus fact — a pending or
 *     missing blob — and it is not this tool's bug.
 *
 * Distinguishing them requires looking at the archive rather than trusting the extraction, so this
 * reads the cached `results.zip` member list directly. `results.zip` member order is an artifact of
 * packing order and is not guaranteed, which is precisely why the presence of an output member is
 * checked rather than its position.
 */
function diagnoseEmptyExtraction(runId: string): string {
    const archive = runArchivePath(runId);
    if (!archive) {
        return 'no instances found (no cached archive to cross-check — run may be pending or missing)';
    }
    const members = zipMemberNames(archive);
    if (members === undefined) {
        return `no instances found (could not read ${archive} to cross-check)`;
    }
    const outputMembers = members.filter(name => name.endsWith('-output.zip'));
    if (outputMembers.length === 0) {
        return `no instances found; the archive carries no *-output.zip member either ` +
            `(${members.length} member(s)). The run produced no instance output — pending or missing, ` +
            'not a reader fault.';
    }
    return `READER FAULT: ${archive} contains ${outputMembers.length} *-output.zip member(s) ` +
        `(${outputMembers.join(', ')}) but the extraction yielded no instances. The data exists and ` +
        'was not loaded — treat this as a bug in this tool or in extraction, NOT as a corpus fact.';
}

/**
 * Whether MSBench considers this run finished, from `results.json`'s `timestamps.completed`.
 *
 * This is the primary guard against auditing a run that has not finished, and it exists because a
 * real incident was misdiagnosed twice before the mechanism was found. A run was audited ~50s
 * before it even initialized and ~5 minutes before it completed; extraction succeeded, exited 0,
 * and produced run metadata with no instance output. Two plausible mechanisms were proposed and
 * investigated — an order-dependent archive reader, and non-atomic blob reconciliation — and both
 * were wrong. The run was simply still executing.
 *
 * A blob-presence check does not catch this: the absence was total, so there was nothing partial to
 * detect. `timestamps.completed` fires deterministically whether the read is five seconds early or
 * five hours early, and it is already written by the CLI, so it costs nothing.
 *
 * Returns undefined when there is no cached `results.json` to consult — an explicitly extracted
 * directory, typically — in which case the run is audited rather than skipped, because refusing to
 * audit data someone handed us directly would be worse than the risk.
 */
function runCompletedAt(runId: string): string | undefined {
    if (!/^\d+$/u.test(runId)) {
        return undefined;
    }
    for (const root of msbenchRunRoots()) {
        const parsed = readJson<{ timestamps?: { completed?: string } }>(join(root, runId, 'results.json'));
        if (parsed) {
            return parsed.timestamps?.completed;
        }
    }
    return undefined;
}

/**
 * `results.json` exists but carries no completion timestamp: the run is still executing, or died
 * without recording one. Either way its results are not a result yet.
 */
function isIncompleteRun(runId: string): boolean {
    if (!/^\d+$/u.test(runId)) {
        return false;
    }
    for (const root of msbenchRunRoots()) {
        const path = join(root, runId, 'results.json');
        if (existsSync(path)) {
            return runCompletedAt(runId) === undefined;
        }
    }
    return false;
}
function runArchivePath(runId: string): string | undefined {
    if (!/^\d+$/u.test(runId)) {
        return undefined;
    }
    for (const root of msbenchRunRoots()) {
        const candidate = join(root, runId, 'results.zip');
        if (existsSync(candidate)) {
            return candidate;
        }
    }
    return undefined;
}

/**
 * Member names from a zip's end-of-central-directory record. Implemented here rather than pulled in
 * as a dependency because it is only ever used to answer "does this archive contain instance
 * output", and being wrong in the conservative direction (returning undefined) is harmless.
 */
function zipMemberNames(archive: string): string[] | undefined {
    let buffer: Buffer;
    try {
        buffer = readFileSync(archive);
    } catch {
        return undefined;
    }
    // Locate the end-of-central-directory signature, scanning back over the max comment length.
    const EOCD = 0x06054b50;
    let eocd = -1;
    for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 22 - 0xffff); offset--) {
        if (buffer.readUInt32LE(offset) === EOCD) {
            eocd = offset;
            break;
        }
    }
    if (eocd === -1) {
        return undefined;
    }
    const count = buffer.readUInt16LE(eocd + 10);
    let pointer = buffer.readUInt32LE(eocd + 16);
    const names: string[] = [];
    for (let index = 0; index < count; index++) {
        if (pointer + 46 > buffer.length || buffer.readUInt32LE(pointer) !== 0x02014b50) {
            return names.length > 0 ? names : undefined;
        }
        const nameLength = buffer.readUInt16LE(pointer + 28);
        const extraLength = buffer.readUInt16LE(pointer + 30);
        const commentLength = buffer.readUInt16LE(pointer + 32);
        names.push(buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8'));
        pointer += 46 + nameLength + extraLength + commentLength;
    }
    return names;
}

// ---------------------------------------------------------------------------
// Reading one instance
// ---------------------------------------------------------------------------

function readJson<T>(path: string): T | undefined {
    if (!existsSync(path)) {
        return undefined;
    }
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as T;
    } catch {
        return undefined;
    }
}

/**
 * `error.json` is the structured cascade signal. Its presence means the instance is void: whatever
 * `eval.json` says about it describes an agent that never got to run.
 */
function instanceFault(instance: Instance): string | undefined {
    for (const path of [join(instance.outputDir, 'error.json'), join(instance.vscOutput, 'error.json')]) {
        const parsed = readJson<{ type?: string }>(path);
        if (parsed) {
            return parsed.type ?? 'UNKNOWN_ERROR';
        }
        if (existsSync(path)) {
            return 'UNREADABLE_ERROR_JSON';
        }
    }
    return undefined;
}

interface ExecRow {
    exitCode: number;
    stdErr: string;
}

/**
 * The `exec` table is where exit 1 and exit 3 stay distinct. MSBench collapses both into
 * "non-zero", so without this a broken grader is indistinguishable from a product regression —
 * and would be tallied as a real failure against the gate.
 */
function readExecRows(sqlitePath: string): Map<string, ExecRow> {
    const rows = new Map<string, ExecRow>();
    if (!existsSync(sqlitePath)) {
        return rows;
    }
    let db: DatabaseSync | undefined;
    try {
        db = new DatabaseSync(sqlitePath, { readOnly: true });
        for (const row of db.prepare('SELECT command, exitCode, stdErr FROM exec').all()) {
            const { command, exitCode, stdErr } = row as { command: string; exitCode: number; stdErr: string };
            rows.set(command, { exitCode, stdErr: stdErr ?? '' });
        }
    } catch {
        // A missing or unreadable exec table just means no exec attribution for this instance.
    } finally {
        db?.close();
    }
    return rows;
}

/** `[AUTOGENERATED] Check 0 exit code for command: '<cmd>'. Original comment: <human>` */
const AUTOGENERATED_EXEC = /^\[AUTOGENERATED\] Check 0 exit code for command: '([\s\S]*)'\. Original comment: ([\s\S]*)$/u;

/** The gate name a human wrote, recovered from the wrapper MSBench generates for `exec:`. */
function shortComment(comment: string): string {
    if (!comment.startsWith('[AUTOGENERATED]')) {
        return comment;
    }
    const exec = comment.match(AUTOGENERATED_EXEC);
    if (exec) {
        return exec[2];
    }
    const marker = '. Original comment: ';
    const index = comment.lastIndexOf(marker);
    return index === -1 ? comment : comment.slice(index + marker.length);
}

function execCommandOf(comment: string): string | undefined {
    return comment.match(AUTOGENERATED_EXEC)?.[1];
}

interface NotApplicable {
    reason: string;
    /** `true` only when the grader positively declared the scenario out of scope. */
    outOfScope: boolean;
}

function parseNotApplicable(stdErr: string): NotApplicable | undefined {
    const line = stdErr.match(NOT_APPLICABLE_MARKER);
    if (!line) {
        return undefined;
    }
    // `detail=` is opaque and free-form, and the two emitters escape it differently (JSON.stringify
    // vs. quote-substitution). Stop scanning before it: otherwise a detail containing the literal
    // text `reason=` would be read as a field. The three fields that matter are closed vocabularies
    // and all precede `detail=`, so cutting here cannot lose them.
    const beforeDetail = line[1].split(/\s+detail=/u)[0];
    const tokens = new Map<string, string>();
    for (const [, key, value] of beforeDetail.matchAll(MARKER_TOKEN)) {
        tokens.set(key, value.replace(/^"|"$/gu, ''));
    }
    return {
        reason: tokens.get('reason') ?? 'unspecified',
        // Deliberate default-by-exclusion: anything that is not explicitly `outOfScope` is treated
        // as a gap. That is the safe direction — never guess a gate into the dead-weight bucket —
        // and it makes a rename of the gap class (environmentGap -> coverageGap) a no-op here.
        //
        // The consequence, recorded so it is a decision rather than an accident: if a THIRD class is
        // ever introduced it lands silently in the gap bucket. A third class therefore needs an
        // explicit ruling on which bucket it joins, and this line updated to match. Raise it before
        // emitting one.
        outOfScope: tokens.get('class') === 'outOfScope',
    };
}

/**
 * The gate's identity, best available.
 *
 * MSBench carries no gate id, so the fallback is the human comment — which is unstable, because a
 * gate that gets reworded starts a fresh history under a new name (see this file's header). Two
 * things improve on it:
 *
 *   1. An explicit `gate=` token on a verdict line, once graders emit it.
 *   2. For an `exec:` gate, the grader's **filename**, which is what `gate=` is derived from. That
 *      recovers a stable identity for runs recorded *before* the convention existed, so the
 *      transition does not split every gate's history in two.
 *
 * Filename identity is deliberately coarser than the comment: every `validate-requirements.ts`
 * invocation is one gate regardless of its flags, matching the certification manifest's validator
 * id. Use `--identity comment` for the raw, per-assertion view.
 */
function graderFilename(command: string): string | undefined {
    const match = command.match(/([\w.-]+)\.ts\b/u);
    return match ? match[1].replace(/^validate-/u, '') : undefined;
}

function gateIdentity(comment: string, stdErr: string | undefined, byComment: boolean): string {
    const human = shortComment(comment);
    if (byComment) {
        return human;
    }
    const declared = stdErr?.match(GATE_ID)?.[1];
    if (declared) {
        return declared;
    }
    const command = execCommandOf(comment);
    const derived = command ? graderFilename(command) : undefined;
    return derived ?? human;
}

// ---------------------------------------------------------------------------
// Tallying
// ---------------------------------------------------------------------------

function tallyOf(tallies: Map<string, GateTally>, gate: string): GateTally {
    let tally = tallies.get(gate);
    if (!tally) {
        tally = {
            passed: 0,
            failed: 0,
            notAttempted: 0,
            notApplicable: 0,
            runs: new Set(),
            instances: 0,
            notAttemptedReasons: new Map(),
            notApplicableReasons: new Map(),
        };
        tallies.set(gate, tally);
    }
    return tally;
}

function bump(counter: Map<string, number>, key: string): void {
    counter.set(key, (counter.get(key) ?? 0) + 1);
}

interface StoredEval {
    resolved?: boolean;
    details?: { comment: string; query?: string; passed: boolean; error: string | null }[];
}

interface AgentConfig {
    promptSteps?: { assertions?: { comment?: string; query?: string; exec?: string; assertZeroExitCode?: boolean }[] }[];
}

/** Assertions the run declared, used when it produced no `eval.json` to name the gates that never ran. */
function declaredGates(configPath: string, identityByComment: boolean): string[] {
    const config = readJson<AgentConfig>(configPath);
    if (!config) {
        return [];
    }
    const gates: string[] = [];
    for (const step of config.promptSteps ?? []) {
        for (const assertion of step.assertions ?? []) {
            // Non-asserting `exec:` entries generate no check, exactly as upstream drops them.
            if (!assertion.comment || (assertion.exec !== undefined && assertion.assertZeroExitCode === false)) {
                continue;
            }
            const derived = !identityByComment && assertion.exec ? graderFilename(assertion.exec) : undefined;
            gates.push(derived ?? shortComment(assertion.comment));
        }
    }
    return gates;
}

function analyzeInstance(
    tallies: Map<string, GateTally>,
    runId: string,
    instance: Instance,
    identityByComment: boolean,
): void {
    const fault = instanceFault(instance);
    const stored = readJson<Record<string, StoredEval>>(join(instance.vscOutput, 'eval.json'));
    const instanceKey = stored ? Object.keys(stored)[0] : undefined;
    const details = instanceKey ? stored?.[instanceKey]?.details ?? [] : undefined;

    // No eval.json at all: the run rendered no verdicts, so name the gates from the config it was
    // given. Skipping the instance instead would hide the very gates that never got to run.
    if (details === undefined) {
        const configPath = join(instance.vscOutput, 'configs', 'final-agent-config.json');
        for (const gate of declaredGates(configPath, identityByComment)) {
            const tally = tallyOf(tallies, gate);
            tally.runs.add(runId);
            tally.instances++;
            tally.notAttempted++;
            bump(tally.notAttemptedReasons, fault ?? 'NO_EVAL_JSON');
        }
        return;
    }

    const execRows = readExecRows(join(instance.vscOutput, 'session.sqlite'));

    for (const detail of details) {
        const command = execCommandOf(detail.comment);
        const exec = command ? execRows.get(command) : undefined;
        const gate = gateIdentity(detail.comment, exec?.stdErr, identityByComment);
        const tally = tallyOf(tallies, gate);
        tally.runs.add(runId);
        tally.instances++;

        const notApplicable = exec ? parseNotApplicable(exec.stdErr) : undefined;

        // Order matters. A void instance discards everything, including passes: the agent produced
        // nothing, so a negative assertion passed trivially rather than meaningfully.
        if (fault) {
            tally.notAttempted++;
            bump(tally.notAttemptedReasons, fault);
        } else if (notApplicable) {
            // Never `passed`, even though the grader exited 0 and MSBench scored it as a pass.
            // This branch is the entire safety mechanism for the exit-0 convention.
            if (notApplicable.outOfScope) {
                tally.notApplicable++;
                bump(tally.notApplicableReasons, notApplicable.reason);
            } else {
                // An environment gap is not dead weight: nobody decided this gate was unnecessary,
                // the environment just could not run it. Reporting it as dead weight would invite
                // deleting a gate to fix a missing binary.
                tally.notAttempted++;
                bump(tally.notAttemptedReasons, notApplicable.reason);
            }
        } else if (detail.error) {
            // The assertion never compiled or returned a non-boolean. `passed: false` would launder
            // a harness fault into a product verdict.
            tally.notAttempted++;
            bump(tally.notAttemptedReasons, 'ASSERTION_ERROR');
        } else if (exec?.exitCode === EXIT_GRADER_ERROR) {
            tally.notAttempted++;
            bump(tally.notAttemptedReasons, 'GRADER_EXIT_3');
        } else if (detail.passed) {
            tally.passed++;
        } else {
            tally.failed++;
            if (!tally.exampleFailure) {
                const evidence = (exec?.stdErr ?? '').split('\n').map(line => line.trim()).find(Boolean);
                tally.exampleFailure = (evidence ?? detail.query ?? '').slice(0, 140);
                tally.exampleFailureRun = runId;
            }
        }
    }
}

function classify(tally: GateTally): Verdict {
    const rendered = tally.passed + tally.failed;
    if (rendered === 0 && tally.notApplicable > 0 && tally.notAttempted === 0) {
        return 'always-not-applicable';
    }
    if (rendered === 0) {
        // Ran nowhere versus ran and never succeeded: the first indicts everything upstream, the
        // second indicts the gate. Collapsing them is what manufactures phantom failures.
        return 'never-attempted';
    }
    if (tally.passed === 0) {
        return 'never-passed';
    }
    if (tally.failed === 0) {
        return 'never-failed';
    }
    return 'healthy';
}

/**
 * Pass rate over **applicable** observations only. Not-applicable and never-attempted results are
 * excluded from the numerator *and* the denominator, so a gate with nothing to judge returns
 * `undefined` — rendered as "n/a", never as 100%. This is contract point 2 in
 * `NOT_APPLICABLE_MARKER`; folding N/A into the numerator is exactly the bug this tool exists to
 * catch, and it would be reintroduced here if anywhere.
 */
function passRate(tally: GateTally): number | undefined {
    const applicable = tally.passed + tally.failed;
    return applicable === 0 ? undefined : tally.passed / applicable;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** Gates declared in today's stimuli. A gate here that no run mentions has never been exercised. */
async function declaredToday(identityByComment: boolean): Promise<Map<string, string[]>> {
    const declared = new Map<string, string[]>();
    if (!existsSync(STIMULI_DIR)) {
        return declared;
    }
    let parse: (source: string) => unknown;
    try {
        ({ parse } = await import('yaml'));
    } catch {
        return declared;
    }
    for (const file of readdirSync(STIMULI_DIR).filter(name => /\.ya?ml$/u.test(name))) {
        let config: AgentConfig;
        try {
            config = parse(readFileSync(join(STIMULI_DIR, file), 'utf8')) as AgentConfig;
        } catch {
            continue;
        }
        for (const step of config?.promptSteps ?? []) {
            for (const assertion of step.assertions ?? []) {
                if (!assertion.comment || (assertion.exec !== undefined && assertion.assertZeroExitCode === false)) {
                    continue;
                }
                const derived = !identityByComment && assertion.exec ? graderFilename(assertion.exec) : undefined;
                const gate = derived ?? shortComment(assertion.comment);
                declared.set(gate, [...(declared.get(gate) ?? []), file.replace(/\.ya?ml$/u, '')]);
            }
        }
    }
    return declared;
}

function printTable(rows: GateRow[]): void {
    const width = Math.min(Math.max(...rows.map(row => row.gate.length)) + 2, 70);
    console.log('');
    console.log(
        `${'GATE'.padEnd(width)}${'pass'.padStart(6)}${'fail'.padStart(6)}` +
        `${'n/att'.padStart(7)}${'n/a'.padStart(6)}${'runs'.padStart(6)}${'rate'.padStart(7)}  VERDICT`
    );
    console.log('-'.repeat(width + 38));
    for (const { gate, tally, verdict, confident } of rows) {
        const name = gate.length > width - 2 ? `${gate.slice(0, width - 5)}...` : gate;
        const rate = passRate(tally);
        console.log(
            `${name.padEnd(width)}${String(tally.passed).padStart(6)}${String(tally.failed).padStart(6)}` +
            `${String(tally.notAttempted).padStart(7)}${String(tally.notApplicable).padStart(6)}` +
            `${String(tally.runs.size).padStart(6)}` +
            // "n/a" rather than 100%: a gate with no applicable observations has no pass rate.
            `${(rate === undefined ? 'n/a' : `${Math.round(rate * 100)}%`).padStart(7)}` +
            `  ${verdict}${confident ? '' : ' (low confidence)'}`
        );
    }
    console.log('');
    console.log('rate = passes over *applicable* observations. Not-applicable and never-attempted');
    console.log('results are excluded from both sides of it, so "n/a" means nothing was judged —');
    console.log('it never means 100%.');
}

function printFindings(rows: GateRow[], minRuns: number, unexercised: Map<string, string[]>): number {
    const of = (verdict: Verdict): GateRow[] => rows.filter(row => row.verdict === verdict);
    const suspect = of('never-passed');
    const starved = of('never-attempted');
    const dead = of('always-not-applicable');
    const vacuous = of('never-failed');

    console.log('');
    console.log('='.repeat(78));
    console.log('WHAT TO GO AND LOOK AT');
    console.log('='.repeat(78));

    let actionable = 0;

    if (suspect.length > 0) {
        actionable++;
        console.log('');
        console.log('NEVER PASSED — a gate that ran and never once succeeded is more likely broken than');
        console.log('the product is to be uniformly incapable of exactly that one thing.');
        for (const { gate, tally, confident } of suspect) {
            console.log(`  * ${gate}`);
            console.log(`      ${tally.failed} failure(s), 0 passes across ${tally.runs.size} run(s)${confident ? '' : ' — too few runs to judge yet'}`);
            if (tally.exampleFailure) {
                console.log(`      e.g. ${tally.exampleFailure}`);
                console.log(`      reproduce: npm run regrade -- ${tally.exampleFailureRun}`);
            }
        }
    }

    if (starved.length > 0) {
        actionable++;
        console.log('');
        console.log('NEVER ATTEMPTED — these never got the chance to run. This indicts whatever is');
        console.log('upstream of them, not the gates, and it says nothing at all about the product.');
        console.log('A gate here is not dead weight: nobody decided it was unnecessary, something is');
        console.log('simply in its way. Fix the cause, not the gate.');
        // Grouped by cause, so one absent prerequisite reads as a single actionable line rather
        // than N separate mystery gates — which is the difference between "install a binary" and
        // "five probes are broken".
        const byCause = new Map<string, GateRow[]>();
        for (const row of starved) {
            const [cause] = [...row.tally.notAttemptedReasons.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['unknown'];
            byCause.set(cause, [...(byCause.get(cause) ?? []), row]);
        }
        for (const [cause, gates] of [...byCause.entries()].sort((a, b) => b[1].length - a[1].length)) {
            console.log('');
            console.log(`  * ${cause} — ${gates.length} gate(s) blocked, 0 real verdicts between them`);
            for (const { gate, tally } of gates) {
                console.log(`      ${gate} (${tally.notAttempted} blocked over ${tally.runs.size} run(s))`);
            }
        }
    }

    if (dead.length > 0) {
        actionable++;
        console.log('');
        console.log('ALWAYS OUT-OF-SCOPE — these declared class=outOfScope every time they ran, and');
        console.log('MSBench scored each as a FAILURE, because an N/A grader exits 3. Nothing here is');
        console.log('evidence about the generated app.');
        console.log('');
        console.log('Applicability is a wiring-time decision. A gate that is out of scope for the stack');
        console.log('it was wired to is a WIRING BUG WITH AN OWNER — fix the stack declaration, not the');
        console.log('gate. And this report only sees the runs it was given, so it can say "out of scope');
        console.log('for the stacks observed" and no more; "dead weight everywhere, delete it" is a claim');
        console.log('about coverage it has no evidence for. Read the stack declarations first.');
        // Grouped by reason so a single cause reads as one line, not N mystery gates.
        const byReason = new Map<string, string[]>();
        for (const { gate, tally } of dead) {
            const [reason] = [...tally.notApplicableReasons.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['unspecified'];
            byReason.set(reason, [...(byReason.get(reason) ?? []), gate]);
        }
        for (const [reason, gates] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
            console.log('');
            console.log(`  * reason=${reason} — ${gates.length} gate(s), 0 applicable observations`);
            console.log(`      ${gates.join(', ')}`);
            console.log(`      Wired to ${gates.length > 1 ? 'stacks these gates' : 'a stack this gate'} cannot answer for, or never wired to one`);
            console.log('      that exercises it.');
        }
    }

    if (unexercised.size > 0) {
        actionable++;
        console.log('');
        console.log('DECLARED BUT NEVER SEEN — in today\'s stimuli, absent from every run audited.');
        console.log('Usually means the stimulus has not been run since the gate was added. If you');
        console.log('audited a subset of runs, expect this list to be long and mostly uninteresting.');
        console.log('');
        console.log('Check the wording before concluding a gate never ran. SQL assertions are keyed by');
        console.log('their comment, so a gate reworded in one stimulus appears here under its old text');
        console.log('while running perfectly under the new one — three such pairs exist in the corpus');
        console.log('today. "This wording has never run" and "this gate has never run" look identical.');
        const listed = [...unexercised.entries()].slice(0, 8);
        for (const [gate, stimuli] of listed) {
            console.log(`  * ${gate}  [${stimuli.join(', ')}]`);
        }
        if (unexercised.size > listed.length) {
            console.log(`  ... and ${unexercised.size - listed.length} more (--json for the full list)`);
        }
    }

    if (vacuous.length > 0) {
        console.log('');
        const confident = vacuous.filter(row => row.confident);
        // A gate that has never failed *and* has sometimes declined to answer is a sharper signal
        // than either alone: it was wired, it ran, it had the chance to have an opinion, and every
        // time it either passed or excused itself. That is the shape of a gate whose failing branch
        // is unreachable.
        const declined = vacuous.filter(row => row.tally.notApplicable > 0 || row.tally.notAttempted > 0);
        console.log(`NEVER FAILED — ${vacuous.length} gate(s) have never discriminated between good and bad`);
        console.log('output. At this corpus size that is expected rather than alarming: a young suite');
        console.log('mostly passes. Watch whether it stays true as the corpus grows.');
        if (declined.length > 0) {
            console.log('');
            console.log('  NEVER RED, AND SOMETIMES DECLINED TO ANSWER — look at these first, ahead of');
            console.log('  the rest. A gate that only ever passes or excuses itself may have a failing');
            console.log('  branch that cannot be reached; check that its not-applicable case is not');
            console.log('  swallowing the evidence that should have made it fail.');
            for (const { gate, tally } of declined) {
                const excused = [...tally.notApplicableReasons.entries(), ...tally.notAttemptedReasons.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 2)
                    .map(([reason, count]) => `${reason}\u00d7${count}`)
                    .join(', ');
                console.log(`  * ${gate}: ${tally.passed} pass, 0 fail, ${tally.notApplicable + tally.notAttempted} declined (${excused})`);
            }
        }
        const plain = confident.filter(row => !declined.includes(row));
        if (plain.length > 0) {
            console.log('');
            console.log(`  Then these (>= ${minRuns} runs and still never red):`);
            for (const { gate, tally } of plain) {
                console.log(`  * ${gate}: ${tally.passed} passes, 0 failures over ${tally.runs.size} runs`);
            }
        } else if (declined.length === 0) {
            console.log(`  None has reached ${minRuns} runs yet, so none is worth investigating on this evidence.`);
        }
    }

    if (actionable === 0 && vacuous.length === 0) {
        console.log('');
        console.log('Nothing to investigate: every gate has both passed and failed at least once.');
    }
    return suspect.filter(row => row.confident).length;
}

function printPreamble(runs: string[], instances: number, voidInstances: number, minRuns: number,
    readerFaults: string[], skipped: string[]): void {
    console.log('');
    console.log('Gate health — auditing the instrument, not the product');
    // Stamped because this report describes a corpus that changes underneath it. A stale reading of
    // a transient condition is what made a still-running run look like a permanent anomaly, and
    // cost several round trips to unpick. It costs nothing to say when the data was read.
    console.log(`Read at ${new Date().toISOString()}`);
    console.log(`${runs.length} run(s), ${instances} instance(s). Verdicts below ${minRuns} runs are marked low confidence.`);
    if (readerFaults.length > 0) {
        // Loud, and deliberately separate from a pending run: this says the numbers below are
        // incomplete for a reason that is our fault, so nothing here should be quoted.
        console.log('');
        console.log(`READER FAULT on ${readerFaults.length} run(s): ${readerFaults.join(', ')}`);
        console.log('Their archives contain instance output that failed to load, so every tally below');
        console.log('is missing data. Fix the reader before believing any verdict — a dropped run');
        console.log('makes gates look never-executed, which is exactly what this report shouts about.');
    }
    if (skipped.length > 0) {
        console.log(`Skipped ${skipped.length} run(s) with no instance output (pending or missing): ${skipped.join(', ')}`);
    }
    if (voidInstances > 0) {
        console.log(
            `${voidInstances} of ${instances} instance(s) were void (the agent never really ran); every verdict in them,\n` +
            'including the passes, is discarded rather than counted. A negative assertion passes\n' +
            'trivially against an empty session, so a void pass is as meaningless as a void failure.'
        );
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    jsonMode = options.json;

    const roots: { runId: string; dir: string }[] = [];
    for (const dir of options.extractedDirs) {
        if (!existsSync(dir)) {
            throw new GateHealthError(`--extracted ${dir} does not exist`);
        }
        roots.push({ runId: dir, dir });
    }

    let runIds = options.runIds;
    if (runIds.length === 0 && roots.length === 0) {
        runIds = localRunIds();
        if (runIds.length === 0) {
            throw new GateHealthError(
                'No run ids given and no local MSBench run cache found.\n' +
                'Pass run ids explicitly — extraction is server-backed, so any run you have access\n' +
                'to works from any machine:  node gate-health.ts 2026082579322454 …'
            );
        }
        log(`Auditing ${runIds.length} run(s) from the local MSBench cache.`);
    }

    for (const runId of runIds) {
        const dir = extractRun(runId, options.refresh);
        if (dir) {
            roots.push({ runId, dir });
        }
    }

    const tallies = new Map<string, GateTally>();
    const auditedRuns: string[] = [];
    const readerFaults: string[] = [];
    const skipped: string[] = [];
    let instanceCount = 0;
    let voidInstances = 0;

    for (const { runId, dir } of roots) {
        // Primary guard: never audit a run MSBench has not marked complete. Checked before the
        // instance scan, because an unfinished run legitimately has no instances and must not be
        // reported as though that were a fact about the corpus.
        if (isIncompleteRun(runId)) {
            log(`  ! ${runId}: skipped — no timestamps.completed in results.json; the run has not finished`);
            skipped.push(runId);
            continue;
        }
        const instances = findInstances(dir);
        if (instances.length === 0) {
            // Never just shrug and continue: a dropped run under-reports coverage invisibly, and it
            // does so in the direction of "never executed" — the loudest verdict here.
            const diagnosis = diagnoseEmptyExtraction(runId);
            log(`  ! ${runId}: ${diagnosis}`);
            (diagnosis.startsWith('READER FAULT') ? readerFaults : skipped).push(runId);
            continue;
        }
        auditedRuns.push(runId);
        for (const instance of instances) {
            instanceCount++;
            if (instanceFault(instance)) {
                voidInstances++;
            }
            analyzeInstance(tallies, runId, instance, options.identityByComment);
        }
    }

    if (tallies.size === 0) {
        throw new GateHealthError('No assertion results found in any audited run; nothing to audit.');
    }

    const rows: GateRow[] = [...tallies.entries()]
        .map(([gate, tally]) => ({
            gate,
            tally,
            verdict: classify(tally),
            confident: tally.runs.size >= options.minRuns,
        }))
        .sort((a, b) => a.gate.localeCompare(b.gate));

    const unexercised = new Map<string, string[]>();
    for (const [gate, stimuli] of await declaredToday(options.identityByComment)) {
        if (!tallies.has(gate)) {
            unexercised.set(gate, stimuli);
        }
    }

    if (options.json) {
        console.log(JSON.stringify({
            readAt: new Date().toISOString(),
            runs: auditedRuns,
            instances: instanceCount,
            voidInstances,
            readerFaults,
            skipped,
            minRuns: options.minRuns,
            gates: rows.map(({ gate, tally, verdict, confident }) => ({
                gate,
                verdict,
                confident,
                passed: tally.passed,
                failed: tally.failed,
                notAttempted: tally.notAttempted,
                notApplicable: tally.notApplicable,
                runs: [...tally.runs],
                instances: tally.instances,
                notAttemptedReasons: Object.fromEntries(tally.notAttemptedReasons),
                notApplicableReasons: Object.fromEntries(tally.notApplicableReasons),
                exampleFailure: tally.exampleFailure,
                exampleFailureRun: tally.exampleFailureRun,
            })),
            declaredButNeverSeen: Object.fromEntries(unexercised),
        }, undefined, 2));
        const confidentSuspects = rows.filter(row => row.verdict === 'never-passed' && row.confident).length;
        process.exitCode = confidentSuspects > 0 ? 1 : 0;
        return;
    }

    printPreamble(auditedRuns, instanceCount, voidInstances, options.minRuns, readerFaults, skipped);
    printTable(rows);
    const confidentSuspects = printFindings(rows, options.minRuns, unexercised);

    console.log('');
    console.log('None of these verdicts proves a defect. Each is a reason to look before quoting a score.');
    if (confidentSuspects > 0) {
        console.log('');
        console.log(`FAIL: ${confidentSuspects} gate(s) ran in ${options.minRuns}+ runs and never once passed.`);
        process.exitCode = 1;
    }
}

main().catch((error: unknown) => {
    if (error instanceof GateHealthError) {
        console.error(`\n${error.message}\n`);
        process.exitCode = 2;
        return;
    }
    throw error;
});
