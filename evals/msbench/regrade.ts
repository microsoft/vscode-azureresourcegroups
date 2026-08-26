#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Re-grade a run that already happened, offline, for **zero tokens**.
 *
 * Every MSBench run costs real money and contends a shared, rate-limited model
 * endpoint. So the loop "change a grader → find out whether it still works" used
 * to cost a paid run each time, and that gets worse as runs grow towards millions
 * of tokens. This script removes the model from that loop entirely.
 *
 * It works because `msbench-cli extract` hands back everything the assertions
 * consumed. In particular `output/vsc-output/session.sqlite` has a `files` table
 * of `(path, content, stepIndex)` holding the **full text** of every file the
 * agent wrote. So the final workspace can be rebuilt on disk from the database,
 * and today's graders re-judged against it without re-running anything. The SQL
 * assertions never needed the workspace at all — they only ever read that sqlite
 * file. See `src/sqliteAssertionDatabase.ts` in microsoft/vscode-copilot-evaluation
 * for the schema; the other tables are `exec`, `toolCalls`, `llm_responses`,
 * `assertions`, `worktree_files` and `llm_grades`.
 *
 * The new verdicts are then diffed against the run's stored `eval.json`, so the
 * question this answers is "does my edited grader still agree with what MSBench
 * decided?" — the exact question that used to require paying for a run.
 *
 *   node regrade.ts 2026082582510393
 *   node regrade.ts 2026082582510393 --keep-workspace   # then poke at the tree
 *
 * ## Exit codes
 *
 *   0 — every re-graded verdict matches the one stored in eval.json
 *   1 — at least one verdict changed (the interesting signal, not always bad)
 *   3 — regrade itself could not run, or a grader exited 3
 *
 * ## Why exit 1 and exit 3 must stay apart
 *
 * `graderHarness.ts` distinguishes exit 1 (the product wrote a bad artifact — a
 * real failure worth reporting) from exit 3 (the grader itself threw — a harness
 * fault that must never be blamed on the product). MSBench collapses both into
 * "non-zero", which is the conservative direction in-container but is exactly the
 * confusion this script exists to clear up: a broken grader looks identical to a
 * product regression. So the verdict column here stays collapsed to match
 * MSBench (a fair diff), while the report prints the attribution and a grader
 * error is called out separately and forces exit 3.
 *
 * ## Two traps, both of which cost real time to rediscover
 *
 * 1. **`--benchmark <report>.json:error` takes NO `@` prefix.** With `@` the CLI
 *    treats the whole token as a literal filename and dies with
 *    `Selection file not found: ...results.json:error`; without it, it resolves
 *    (`benchmark_database.py` ~lines 1519-1588). Selectors are `resolved`,
 *    `unresolved`, `error`, `missing`, plus `no_eval_or_error_json` and
 *    `no_error_json_unresolved` — the last two meaning "the harness broke, not
 *    the product".
 *
 *    **But the status-selector form does not work for dataset-driven runs**, and
 *    this suite is heading that way. The report keys instances by a *reformatted*
 *    name — benchmark `vscbench`, instance `say_hello.<instance_id>` (see
 *    `reformat_image_tags_to_old_format`, `benchmark_database.py:371-379`) —
 *    while a custom `--dataset` declares its own benchmark name and bare instance
 *    ids. The selector resolves against the dataset, matches nothing, and errors:
 *
 *        ERROR Instance 'say_hello.gpt_5_6_sol' not found in benchmark 'vscbench'
 *
 *    For a custom-dataset suite, re-select explicitly instead:
 *
 *        msbench-cli run ... --benchmark <benchmark>.<instance_id> <benchmark>.<instance_id>
 *
 *    Partial re-runs are routine plumbing here, not exception handling: a recent
 *    5-instance run came back with 2 instances `missing` (no output blob — an
 *    infrastructure failure, not a model verdict). This script is the free half
 *    of that loop; explicit re-selection is the paid half.
 *
 * 2. **Every assertion query must be a real table query.** The engine appends
 *    ` WHERE stepIndex = :stepIndex` (or ` AND …` when a WHERE already exists), so
 *    a placeholder like `SELECT 0` becomes `SELECT 0 WHERE stepIndex = :stepIndex`
 *    and dies with `X_ASSERTION_DOES_NOT_COMPILE`. That silently broke an entire
 *    probe run.
 *
 * Runs straight off source via Node's built-in type stripping — no build step.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

/** Default extraction cache. Gitignored; reused across iterations so re-grading is a local operation. */
const CACHE_ROOT = join(HERE, '.regrade');

/**
 * `stage-graders.ts` copies the grader tree into the container preserving
 * repo-relative paths, so `/agent/assets/graders/evals/graders/x.ts` is
 * `<repo>/evals/graders/x.ts`. Rewriting this prefix is the whole point of the
 * script: it is what makes the re-run use *today's* graders rather than the
 * ones that were staged when the run happened.
 */
const CONTAINER_GRADER_PREFIX = '/agent/assets/graders/';

/** Mirrors `graderHarness.ts`. Kept in sync by hand — it is a contract, not an import. */
const EXIT_PASS = 0;
const EXIT_PRODUCT_FAILURE = 1;
const EXIT_GRADER_ERROR = 3;

interface QueryAssertion {
    comment: string;
    query: string;
    enableImpliedStepIndexFilter?: boolean;
}

interface ExecAssertion {
    comment: string;
    exec: string;
    assertZeroExitCode?: boolean;
}

type ConfigAssertion = QueryAssertion | ExecAssertion | Record<string, unknown>;

interface AgentConfig {
    promptSteps?: { assertions?: ConfigAssertion[] }[];
    modelSelector?: unknown;
}

/** One entry of `eval.json`'s `details`, plus the attribution MSBench cannot express. */
interface Verdict {
    comment: string;
    /** The comment a human wrote, carried explicitly rather than recovered by regex. */
    humanComment: string;
    query: string;
    passed: boolean;
    error: string | null;
    /** Present only for re-run `exec:` graders — this is where exit 1 and exit 3 stay distinct. */
    exec?: {
        command: string;
        exitCode: number | null;
        attribution: 'pass' | 'product-failure' | 'grader-error' | 'unexpected';
        stdErr: string;
    };
}

interface StoredEval {
    instanceId: string;
    resolved: boolean;
    details: { comment: string; query: string; passed: boolean; error: string | null }[];
}

interface Instance {
    /** Directory name minus the `-output` suffix, e.g. `vscbench.eval.x86_64.say_hello`. */
    name: string;
    vscOutput: string;
    sqlitePath: string;
    configPath: string;
    evalJsonPath: string;
}

interface Options {
    runId?: string;
    extractedDir?: string;
    extractDir?: string;
    instance?: string;
    configOverride?: string;
    refresh: boolean;
    keepWorkspace: boolean;
    json: boolean;
}

class RegradeError extends Error { }

/**
 * Diagnostics go to stderr whenever `--json` is on, so stdout stays a single
 * parseable document.
 */
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

const USAGE = `Re-grade a past MSBench run against today's graders. Costs zero tokens.

Usage:
  node regrade.ts <run-id> [options]
  node regrade.ts --extracted <dir> [options]

Options:
  --instance <id>      Narrow \`msbench-cli extract\` to a single instance.
  --extracted <dir>    Re-grade an already-extracted directory; skips extraction.
  --extract-dir <dir>  Where to extract (default: evals/msbench/.regrade/<run-id>).
                       Reused if it already holds an extraction.
  --refresh            Re-extract even when the directory already has one.
  --config <path>      Grade with a different config (.json/.yaml) instead of the
                       run's stored final-agent-config.json. Use this to try an
                       edited assertion against stored data.
  --keep-workspace     Leave the rehydrated workspace on disk and print its path.
  --json               Emit the report as JSON.
  -h, --help           Show this help.

Requires \`msbench-cli\` on PATH unless --extracted is used:
  export PATH="$HOME/.msbench-venv/bin:$PATH"`;

function parseArgs(argv: string[]): Options {
    const options: Options = { refresh: false, keepWorkspace: false, json: false };

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        const next = (): string => {
            const value = argv[++index];
            if (value === undefined) {
                throw new RegradeError(`${arg} needs a value`);
            }
            return value;
        };

        switch (arg) {
            case '-h': case '--help': console.log(USAGE); process.exit(0); break;
            case '--instance': options.instance = next(); break;
            case '--extracted': options.extractedDir = next(); break;
            case '--extract-dir': options.extractDir = next(); break;
            case '--config': options.configOverride = next(); break;
            case '--refresh': options.refresh = true; break;
            case '--keep-workspace': options.keepWorkspace = true; break;
            case '--json': options.json = true; break;
            default:
                if (arg.startsWith('-')) {
                    throw new RegradeError(`Unknown option ${arg}\n\n${USAGE}`);
                }
                if (options.runId) {
                    throw new RegradeError(`Unexpected second run id '${arg}'`);
                }
                options.runId = arg;
        }
    }

    if (!options.runId && !options.extractedDir) {
        throw new RegradeError(`Give a run id or --extracted <dir>.\n\n${USAGE}`);
    }
    return options;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * `extract` is free — it only downloads a stored results blob and never touches a
 * model — but it is not instant, so an existing extraction is reused by default.
 */
function resolveExtraction(options: Options): string {
    if (options.extractedDir) {
        const dir = resolve(options.extractedDir);
        if (!existsSync(dir)) {
            throw new RegradeError(`--extracted ${dir} does not exist`);
        }
        return dir;
    }

    const dir = resolve(options.extractDir ?? join(CACHE_ROOT, options.runId!));
    // Only reuse a cache that actually holds what was asked for: a cache built by
    // an earlier `--instance A` must not silently satisfy a later `--instance B`.
    const cached = findInstances(dir).instances;
    const satisfiesRequest = cached.length > 0 &&
        (!options.instance || cached.some(candidate => matchesInstance(candidate.name, options.instance!)));

    if (!options.refresh && satisfiesRequest) {
        log(`Reusing extraction at ${dir} (--refresh to re-download)`);
        return dir;
    }

    mkdirSync(dirname(dir), { recursive: true });
    const args = ['extract', '--run_id', options.runId!, '--output', dir];
    if (options.instance) {
        args.push('--instance', options.instance);
    }

    log(`$ msbench-cli ${args.join(' ')}`);
    const result = spawnSync('msbench-cli', args, { stdio: 'inherit' });
    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new RegradeError(
            'msbench-cli is not on PATH. Run:\n' +
            '  export PATH="$HOME/.msbench-venv/bin:$PATH"\n' +
            'Invoking it by absolute path breaks its plugin discovery, so it has to be on PATH.'
        );
    }
    if (result.status !== 0) {
        throw new RegradeError(
            `msbench-cli extract exited ${result.status}. If this is an auth failure, run \`az login\` — ` +
            'extraction reads a stored blob and needs an Azure identity.'
        );
    }
    return dir;
}

/** `say_hello` should select `vscbench.eval.x86_64.say_hello`, but not by accident. */
function matchesInstance(name: string, requested: string): boolean {
    return name === requested || name.endsWith(`.${requested}`) || name.includes(requested);
}

/**
 * An MSBench extraction holds one `<instance>-output/output/vsc-output` tree per
 * instance. A directory with no `session.sqlite` is *reported* rather than
 * quietly skipped: that is an instance whose output blob never arrived —
 * infrastructure failing rather than a verdict — and dropping it silently would
 * let a partial extraction report a clean bill of health.
 */
function findInstances(root: string): { instances: Instance[]; incomplete: string[] } {
    if (!existsSync(root)) {
        return { instances: [], incomplete: [] };
    }
    const instances: Instance[] = [];
    const incomplete: string[] = [];

    for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.endsWith('-output')) {
            continue;
        }
        const vscOutput = join(root, entry.name, 'output', 'vsc-output');
        const sqlitePath = join(vscOutput, 'session.sqlite');
        const name = entry.name.replace(/-output$/, '');
        if (!existsSync(sqlitePath)) {
            incomplete.push(name);
            continue;
        }
        instances.push({
            name,
            vscOutput,
            sqlitePath,
            configPath: join(vscOutput, 'configs', 'final-agent-config.json'),
            evalJsonPath: join(vscOutput, 'eval.json'),
        });
    }
    return { instances: instances.sort((a, b) => a.name.localeCompare(b.name)), incomplete };
}

/**
 * A throttled run is *void*, not red: the agent produced nothing, so every
 * artifact assertion fails for a reason that has nothing to do with the product.
 * Re-grading one reproduces a wall of meaningless failures, so refuse. This is a
 * deliberately narrow check of the run's own `error.json`, independent of
 * `verify-run.ts` rather than coupled to it.
 */
function assertRunIsGradeable(instance: Instance): void {
    const errorJson = join(instance.vscOutput, '..', 'error.json');
    if (!existsSync(errorJson)) {
        return;
    }
    try {
        const parsed = JSON.parse(readFileSync(errorJson, 'utf8')) as { type?: string };
        if (parsed.type === 'RATE_LIMIT') {
            throw new RegradeError(
                `${instance.name} was rate limited (error.json type=RATE_LIMIT). The agent produced nothing, ` +
                'so the run is void rather than red and re-grading it would only reproduce meaningless failures.'
            );
        }
    } catch (error) {
        if (error instanceof RegradeError) {
            throw error;
        }
        // An unreadable error.json is not itself a reason to refuse.
    }
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * `eval.json` is `{ [instanceId]: { resolved, details } }` — a single key, which
 * is also the `--instance-id` the run was graded under. Reading it from here
 * rather than guessing from the directory name keeps the diff aligned.
 */
function readStoredEval(instance: Instance): StoredEval {
    if (!existsSync(instance.evalJsonPath)) {
        throw new RegradeError(
            `${instance.evalJsonPath} is missing. The run produced no assertion results — ` +
            'that is the harness failing rather than the product, and there is nothing to diff against.'
        );
    }
    const parsed = JSON.parse(readFileSync(instance.evalJsonPath, 'utf8')) as Record<string, {
        resolved: boolean;
        details: StoredEval['details'];
    }>;
    const [instanceId] = Object.keys(parsed);
    if (!instanceId) {
        throw new RegradeError(`${instance.evalJsonPath} has no instance key`);
    }
    return { instanceId, resolved: parsed[instanceId].resolved, details: parsed[instanceId].details ?? [] };
}

async function readConfig(path: string): Promise<AgentConfig> {
    if (!existsSync(path)) {
        throw new RegradeError(`Config ${path} does not exist`);
    }
    const source = readFileSync(path, 'utf8');
    if (!/\.ya?ml$/i.test(path)) {
        return JSON.parse(source) as AgentConfig;
    }
    // Only YAML configs need the parser, so pay for it only then — the extracted
    // final-agent-config.json is JSON and keeps the common path dependency-free.
    try {
        const { parse } = await import('yaml');
        return parse(source) as AgentConfig;
    } catch {
        throw new RegradeError(`Reading a YAML config needs the 'yaml' package: run \`npm install\` in evals/`);
    }
}

// ---------------------------------------------------------------------------
// Workspace rehydration
// ---------------------------------------------------------------------------

/**
 * Rebuild the run's final workspace from the `files` table. Highest `stepIndex`
 * wins per path, which is the state the graders saw when the run ended.
 */
function rehydrateWorkspace(sqlitePath: string): { dir: string; fileCount: number } {
    const db = new DatabaseSync(sqlitePath, { readOnly: true });
    let dir: string | undefined;
    try {
        const rows = db.prepare('SELECT path, content, stepIndex FROM files ORDER BY stepIndex ASC, id ASC')
            .all() as { path: string; content: string; stepIndex: number }[];

        dir = mkdtempSync(join(tmpdir(), 'msbench-regrade-'));
        const latest = new Map<string, string>();
        for (const row of rows) {
            latest.set(row.path, row.content);
        }

        for (const [path, content] of latest) {
            const target = join(dir, path);
            // The database is a run artifact, not trusted input, and a `..` or an
            // absolute path would write outside the temp directory. Compare against
            // `dir + sep` so a sibling directory with a longer name cannot pass.
            if (isAbsolute(path) || !normalize(target).startsWith(dir + sep)) {
                throw new RegradeError(`files table has an unsafe path: ${path}`);
            }
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, content);
        }
        return { dir, fileCount: latest.size };
    } catch (error) {
        // Don't strand a half-written workspace in tmp when a path is rejected.
        if (dir) {
            rmSync(dir, { recursive: true, force: true });
        }
        throw error;
    } finally {
        db.close();
    }
}

// ---------------------------------------------------------------------------
// Assertion compilation — mirrors sqliteAssertionDatabase.ts
// ---------------------------------------------------------------------------

function isQueryAssertion(assertion: ConfigAssertion): assertion is QueryAssertion {
    return typeof (assertion as QueryAssertion).query === 'string';
}

function isExecAssertion(assertion: ConfigAssertion): assertion is ExecAssertion {
    return typeof (assertion as ExecAssertion).exec === 'string';
}

/**
 * Verbatim port of `SQLiteAssertionDatabase.formatWithStepIndexFilter`. This is
 * trap 2 in the header: the filter is appended unconditionally, so an assertion
 * that is not a real table query cannot compile.
 */
function withStepIndexFilter(query: string, enabled: boolean): string {
    if (!enabled) {
        return query;
    }
    const filter = /\bWHERE\b/i.test(query) ? 'AND stepIndex = :stepIndex' : 'WHERE stepIndex = :stepIndex';
    const trailing = query.match(/\b(LIMIT|ORDER\s+BY|GROUP\s+BY)\b/i);
    if (trailing?.index !== undefined) {
        return `${query.slice(0, trailing.index).trimEnd()} ${filter} ${query.slice(trailing.index)}`;
    }
    return `${query} ${filter}`;
}

/** The exact comment upstream generates for an asserting `exec:`, used to line the diff up. */
function autogeneratedComment(assertion: ExecAssertion): string {
    return `[AUTOGENERATED] Check 0 exit code for command: '${assertion.exec}'. ` +
        `Original comment: ${assertion.comment}`;
}

interface CompiledQuery {
    kind: 'query';
    comment: string;
    humanComment: string;
    query: string;
    parameters: Record<string, string | number>;
}

interface CompiledExec {
    kind: 'exec';
    comment: string;
    humanComment: string;
    command: string;
}

type Compiled = CompiledQuery | CompiledExec;

/**
 * Walk the config's steps in order, producing the same assertion list — same
 * order, same comments — that the in-container run produced. Non-asserting
 * `exec:` entries (`assertZeroExitCode: false`, the environment fingerprint) are
 * dropped exactly as upstream drops them, so the count still matches.
 */
function compile(config: AgentConfig): Compiled[] {
    const compiled: Compiled[] = [];
    const steps = config.promptSteps ?? [];

    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
        for (const assertion of steps[stepIndex].assertions ?? []) {
            if (isQueryAssertion(assertion)) {
                const enabled = assertion.enableImpliedStepIndexFilter ?? true;
                compiled.push({
                    kind: 'query',
                    comment: assertion.comment,
                    humanComment: assertion.comment,
                    query: withStepIndexFilter(assertion.query, enabled),
                    parameters: enabled ? { stepIndex } : {},
                });
            } else if (isExecAssertion(assertion) && assertion.assertZeroExitCode !== false) {
                // Upstream tests `if (assertion.assertZeroExitCode)` — but only after zod
                // has applied `.default(true)` (`src/common/schemas.ts`). `!== false`
                // reproduces that effective behaviour, and unlike a literal port it still
                // holds for a raw stimulus YAML read via --config, where the field is
                // usually just omitted and no zod defaulting has run.
                compiled.push({
                    kind: 'exec',
                    comment: autogeneratedComment(assertion),
                    // Carried explicitly rather than recovered from the generated string,
                    // which embeds the command and may span lines.
                    humanComment: assertion.comment,
                    command: assertion.exec,
                });
            }
        }
    }
    return compiled;
}

// ---------------------------------------------------------------------------
// SQL assertions
// ---------------------------------------------------------------------------

/**
 * `vsc-eval` (bin of `@vscode/vscode-copilot-evaluation-agent`) is what runs
 * in-container, so prefer it when it exists — the invocation below is what
 * `run-agent.sh` does at ~line 504, and it only reads the sqlite file.
 *
 * It is not on the public npm registry: the package is built from the internal
 * microsoft/vscode-copilot-evaluation repo. So point `VSC_EVAL_BIN` at a local
 * checkout's `dist/index.js` if you have one, and otherwise this script falls
 * back to evaluating the compiled SQL itself with `node:sqlite`, using the port
 * of `formatWithStepIndexFilter` above. Both paths are verified against the
 * stored `eval.json` of a known run, which is what `--json` diffing is for.
 */
function findVscEval(): { command: string; leadingArgs: string[] } | undefined {
    const override = process.env.VSC_EVAL_BIN;
    if (override) {
        return override.endsWith('.js')
            ? { command: process.execPath, leadingArgs: [override] }
            : { command: override, leadingArgs: [] };
    }
    const probe = spawnSync('vsc-eval', ['--version'], { stdio: 'ignore' });
    return probe.error ? undefined : { command: 'vsc-eval', leadingArgs: [] };
}

/**
 * Results are queued per comment and consumed in order, so duplicate comments
 * each get their own verdict rather than all collapsing onto the last one.
 */
function runVscEval(
    binary: { command: string; leadingArgs: string[] },
    configPath: string,
    sqlitePath: string,
    instanceId: string
): Map<string, { passed: boolean; error: string | null }[]> {
    const outputDir = mkdtempSync(join(tmpdir(), 'msbench-regrade-eval-'));
    try {
        const outputFile = join(outputDir, 'eval.json');
        const args = [
            ...binary.leadingArgs,
            'assertions', 'assert',
            '--config-path', configPath,
            '--database-file', sqlitePath,
            '--output-file', outputFile,
            '--instance-id', instanceId,
        ];

        const result = spawnSync(binary.command, args, { encoding: 'utf8' });
        if (result.status !== 0 || !existsSync(outputFile)) {
            throw new RegradeError(
                `vsc-eval assertions assert exited ${result.status}.\n${result.stderr ?? ''}`.trim()
            );
        }

        const parsed = JSON.parse(readFileSync(outputFile, 'utf8')) as Record<string, { details: StoredEval['details'] }>;
        const verdicts = new Map<string, { passed: boolean; error: string | null }[]>();
        for (const detail of parsed[instanceId]?.details ?? []) {
            const queue = verdicts.get(detail.comment) ?? [];
            queue.push({ passed: detail.passed, error: detail.error });
            verdicts.set(detail.comment, queue);
        }
        return verdicts;
    } finally {
        rmSync(outputDir, { recursive: true, force: true });
    }
}

/**
 * Port of `executeAssertionQuery`, including its error semantics: no rows is a
 * fail, and anything that is not a single boolean-ish column is an error rather
 * than a verdict.
 */
function evaluateQuery(db: DatabaseSync, compiled: CompiledQuery): { passed: boolean; error: string | null } {
    try {
        const rows = db.prepare(compiled.query).all(compiled.parameters) as Record<string, unknown>[];
        if (rows.length === 0) {
            return { passed: false, error: null };
        }
        if (rows.length > 1) {
            throw new Error('Assertion query returned more than one row; expected exactly one row');
        }
        const columns = Object.keys(rows[0]);
        if (columns.length !== 1) {
            throw new Error('Assertion query must return exactly one column');
        }
        const value = rows[0][columns[0]];
        if (typeof value === 'number' && value <= 1) {
            return { passed: value === 1, error: null };
        }
        throw new Error('Assertion query must return a boolean value');
    } catch (error) {
        return { passed: false, error: error instanceof Error ? error.message : String(error) };
    }
}

// ---------------------------------------------------------------------------
// exec: graders
// ---------------------------------------------------------------------------

function localiseCommand(command: string): string {
    return command.split(CONTAINER_GRADER_PREFIX).join(`${REPO_ROOT}/`);
}

/**
 * Run one `exec:` grader against the rehydrated workspace.
 *
 * `exec:` runs in-container with `shell: true` and cwd set to the workspace, so
 * `graderHarness`'s `process.cwd()` fallback resolves `.azure/requirements.json`
 * — the same is true here. `EVALUATE_WORKSPACE` is deliberately *deleted* rather
 * than set: the harness prefers it over cwd, so an ambient value in the
 * developer's shell would silently grade some other tree.
 */
function runExecGrader(compiled: CompiledExec, workspace: string): Verdict {
    const command = localiseCommand(compiled.command);
    const env = { ...process.env };
    delete env.EVALUATE_WORKSPACE;

    const result = spawnSync(command, { shell: true, cwd: workspace, encoding: 'utf8', env });
    if (result.error) {
        return {
            comment: compiled.comment,
            humanComment: compiled.humanComment,
            query: command,
            passed: false,
            error: `could not launch grader: ${result.error.message}`,
            exec: { command, exitCode: null, attribution: 'grader-error', stdErr: '' },
        };
    }

    const exitCode = result.status;
    // Anything outside the harness's 0/1/3 vocabulary — a signal, or an exit code
    // the harness never emits — is not a verdict we can trust either, so it is
    // 'unexpected' and counted as a fault alongside 'grader-error'.
    const attribution = exitCode === EXIT_PASS ? 'pass'
        : exitCode === EXIT_PRODUCT_FAILURE ? 'product-failure'
            : exitCode === EXIT_GRADER_ERROR ? 'grader-error'
                : 'unexpected';

    return {
        comment: compiled.comment,
        humanComment: compiled.humanComment,
        query: command,
        // Collapsed to match how MSBench scored it, so the diff stays apples-to-apples.
        // The attribution above is where exit 1 and exit 3 stay distinct.
        passed: exitCode === EXIT_PASS,
        error: null,
        exec: { command, exitCode, attribution, stdErr: (result.stderr ?? '').trim() },
    };
}

/**
 * A verdict that could not be computed honestly. These force exit 3 whether or
 * not the verdict moved, because a grader that crashes while still reporting
 * FAIL is otherwise invisible — the diff just says "unchanged".
 */
function faultOf(verdict: Verdict): string | undefined {
    if (verdict.exec && (verdict.exec.attribution === 'grader-error' || verdict.exec.attribution === 'unexpected')) {
        return `${verdict.humanComment}: grader exited ${verdict.exec.exitCode ?? 'abnormally'}`;
    }
    // A query that fails to compile or returns a non-boolean is trap 2 in the
    // header, not a product verdict — `passed: false` would launder it into one.
    if (verdict.error) {
        return `${verdict.humanComment}: ${verdict.error}`;
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

type Direction = 'unchanged' | 'regressed' | 'fixed' | 'added' | 'removed';

interface Comparison {
    comment: string;
    direction: Direction;
    stored: boolean | undefined;
    regraded: boolean | undefined;
    verdict?: Verdict;
}

/**
 * Assertions are matched on the *human-written* comment, not the autogenerated
 * wrapper. An `exec:` assertion's generated comment embeds the whole command, so
 * keying on it would report "add + remove" the moment a grader gains a flag —
 * which is precisely the edit this script exists to evaluate. Duplicate comments
 * are disambiguated by their occurrence order, which `compare` warns about
 * because that pairing is only a guess once the duplicate count changes.
 */
function matchKey(comment: string, seen: Map<string, number>): string {
    const occurrence = seen.get(comment) ?? 0;
    seen.set(comment, occurrence + 1);
    return `${comment}#${occurrence}`;
}

function compare(stored: StoredEval, regraded: Verdict[]): { comparisons: Comparison[]; warnings: string[] } {
    const storedSeen = new Map<string, number>();
    const storedByKey = new Map(stored.details.map(detail => [matchKey(shortComment(detail.comment), storedSeen), detail]));

    const regradedSeen = new Map<string, number>();
    const matched = new Set<string>();
    const comparisons: Comparison[] = [];

    for (const verdict of regraded) {
        const key = matchKey(verdict.humanComment, regradedSeen);
        matched.add(key);
        const previous = storedByKey.get(key);
        const direction: Direction = previous === undefined ? 'added'
            : previous.passed === verdict.passed ? 'unchanged'
                : previous.passed ? 'regressed' : 'fixed';
        comparisons.push({ comment: verdict.humanComment, direction, stored: previous?.passed, regraded: verdict.passed, verdict });
    }

    for (const [key, detail] of storedByKey) {
        if (!matched.has(key)) {
            comparisons.push({ comment: shortComment(detail.comment), direction: 'removed', stored: detail.passed, regraded: undefined });
        }
    }

    // Pairing duplicates by position is a guess, and it is only wrong when the
    // number of duplicates changed — say the first of two same-named assertions
    // was deleted. Say so rather than reporting a confident phantom regression.
    const warnings: string[] = [];
    for (const [comment, count] of regradedSeen) {
        if (count > 1 && (storedSeen.get(comment) ?? 0) !== count) {
            warnings.push(
                `"${comment}" appears ${count} times with a different count in the stored eval.json; ` +
                'those rows are paired by position and may be mismatched. Give them distinct comments.'
            );
        }
    }
    return { comparisons, warnings };
}

const MARKERS: Record<Direction, string> = {
    unchanged: '  =',
    regressed: '  ▼',
    fixed: '  ▲',
    added: '  +',
    removed: '  -',
};

function describe(passed: boolean | undefined): string {
    return passed === undefined ? '—' : passed ? 'pass' : 'FAIL';
}

/**
 * Recover the human-written comment from a stored `eval.json` detail, which only
 * carries the generated string. Regraded verdicts don't need this — they carry
 * `humanComment` explicitly.
 *
 * The exec form is `[AUTOGENERATED] Check 0 exit code for command: '<cmd>'. Original
 * comment: <comment>`, so anchor on the quote-dot delimiter and match the command
 * greedily across newlines: a non-greedy `.*?` would stop early on a multi-line
 * command, or on a command that happens to contain "Original comment: ".
 */
function shortComment(comment: string): string {
    if (!comment.startsWith('[AUTOGENERATED]')) {
        return comment;
    }
    const exec = comment.match(/^\[AUTOGENERATED\] Check 0 exit code for command: '[\s\S]*'\. Original comment: ([\s\S]*)$/);
    if (exec) {
        return exec[1];
    }
    // The other autogenerated forms (workspace changes, diagnostics, LLM grading)
    // share the same trailing delimiter.
    const marker = '. Original comment: ';
    const index = comment.lastIndexOf(marker);
    return index === -1 ? comment : comment.slice(index + marker.length);
}

function printReport(instance: Instance, stored: StoredEval, comparisons: Comparison[], fileCount: number, sqlEngine: string): void {
    console.log('');
    console.log(`Instance   ${stored.instanceId}  (${instance.name})`);
    console.log(`Workspace  ${fileCount} files rehydrated from session.sqlite`);
    console.log(`SQL engine ${sqlEngine}`);
    console.log('');
    console.log('  stored  regraded  assertion');
    console.log('  ' + '-'.repeat(70));

    for (const comparison of comparisons) {
        console.log(
            `${MARKERS[comparison.direction]} ${describe(comparison.stored).padEnd(6)}  ` +
            `${describe(comparison.regraded).padEnd(8)}  ${comparison.comment}`
        );

        const exec = comparison.verdict?.exec;
        if (exec) {
            const label = exec.attribution === 'pass' ? 'exit 0 — pass'
                : exec.attribution === 'product-failure' ? `exit ${exec.exitCode} — PRODUCT FAILURE (bad artifact)`
                    : exec.attribution === 'grader-error' ? `exit ${exec.exitCode} — GRADER ERROR (harness fault, not the product)`
                        : `exit ${exec.exitCode ?? '?'} — ABNORMAL EXIT (not a verdict; treated as a harness fault)`;
            console.log(`         ${label}`);
            for (const line of exec.stdErr.split('\n').filter(Boolean).slice(0, 6)) {
                console.log(`           ${line}`);
            }
        }
        if (comparison.verdict?.error) {
            console.log(`         ASSERTION ERROR (harness fault, not the product): ${comparison.verdict.error}`);
        }
    }
    console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface InstanceResult {
    changed: number;
    /** Anything that makes a verdict untrustworthy: a broken grader, an uncompilable query. */
    faults: string[];
    warnings: string[];
    payload: unknown;
}

async function regradeInstance(instance: Instance, options: Options): Promise<InstanceResult> {
    assertRunIsGradeable(instance);
    const stored = readStoredEval(instance);
    const configPath = options.configOverride ? resolve(options.configOverride) : instance.configPath;
    const config = await readConfig(configPath);
    const compiled = compile(config);

    const { dir: workspace, fileCount } = rehydrateWorkspace(instance.sqlitePath);
    try {
        const vscEval = findVscEval();
        let sqlVerdicts: Map<string, { passed: boolean; error: string | null }[]> | undefined;
        let sqlEngine: string;

        if (vscEval) {
            sqlVerdicts = runVscEval(vscEval, configPath, instance.sqlitePath, stored.instanceId);
            sqlEngine = `vsc-eval (${vscEval.leadingArgs[0] ?? vscEval.command})`;
        } else {
            sqlEngine = 'node:sqlite (vsc-eval not found; set VSC_EVAL_BIN to use it)';
        }

        const db = new DatabaseSync(instance.sqlitePath, { readOnly: true });
        const regraded: Verdict[] = [];
        try {
            for (const item of compiled) {
                if (item.kind === 'exec') {
                    regraded.push(runExecGrader(item, workspace));
                    continue;
                }
                // Shift rather than get, so duplicate comments consume one result each.
                const result = sqlVerdicts?.get(item.comment)?.shift() ?? evaluateQuery(db, item);
                regraded.push({
                    comment: item.comment,
                    humanComment: item.humanComment,
                    query: item.query,
                    passed: result.passed,
                    error: result.error,
                });
            }
        } finally {
            db.close();
        }

        const { comparisons, warnings } = compare(stored, regraded);
        const faults = regraded.map(faultOf).filter((fault): fault is string => fault !== undefined);
        const changed = comparisons.filter(comparison => comparison.direction !== 'unchanged').length;

        if (options.json) {
            return {
                changed,
                faults,
                warnings,
                payload: { instanceId: stored.instanceId, storedResolved: stored.resolved, sqlEngine, workspace, faults, warnings, comparisons },
            };
        }

        printReport(instance, stored, comparisons, fileCount, sqlEngine);
        return { changed, faults, warnings, payload: undefined };
    } finally {
        if (options.keepWorkspace) {
            log(`Rehydrated workspace kept at ${workspace}`);
        } else {
            rmSync(workspace, { recursive: true, force: true });
        }
    }
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    jsonMode = options.json;
    const root = resolveExtraction(options);

    const { instances: discovered, incomplete } = findInstances(root);
    if (discovered.length === 0) {
        throw new RegradeError(
            `No instance output found under ${root} (expected <instance>-output/output/vsc-output/session.sqlite)` +
            (incomplete.length ? `\nIncomplete instances with no session.sqlite: ${incomplete.join(', ')}` : '')
        );
    }

    let instances = discovered;
    if (options.instance) {
        const filtered = discovered.filter(candidate => matchesInstance(candidate.name, options.instance!));
        if (filtered.length === 0) {
            throw new RegradeError(
                `No instance matching '${options.instance}'. Available: ${discovered.map(i => i.name).join(', ')}`
            );
        }
        if (filtered.length > 1) {
            throw new RegradeError(
                `'${options.instance}' matches ${filtered.length} instances: ${filtered.map(i => i.name).join(', ')}. Be more specific.`
            );
        }
        instances = filtered;
    }

    let changed = 0;
    const faults: string[] = [];
    const warnings: string[] = [];
    const payloads: unknown[] = [];

    // An instance whose output blob never arrived is infrastructure failing, not a
    // verdict. Reporting the rest as clean would be the same laundering this script
    // exists to prevent.
    for (const name of incomplete) {
        faults.push(`${name}: no session.sqlite in the extraction (instance output missing)`);
    }

    for (const instance of instances) {
        const result = await regradeInstance(instance, options);
        changed += result.changed;
        faults.push(...result.faults);
        warnings.push(...result.warnings);
        if (result.payload) {
            payloads.push(result.payload);
        }
    }

    if (options.json) {
        console.log(JSON.stringify({ changed, faults, warnings, instances: payloads }, null, 2));
    } else {
        for (const warning of warnings) {
            console.log(`WARNING: ${warning}`);
        }
        if (faults.length > 0) {
            console.log(`${faults.length} result(s) cannot be trusted — the harness broke, not the product:`);
            for (const fault of faults) {
                console.log(`  ${fault}`);
            }
            console.log('Fix that before reading anything else here.');
        } else if (changed === 0) {
            console.log(`No verdict changed. Today's graders agree with the stored eval.json.`);
        } else {
            console.log(`${changed} verdict(s) changed against the stored eval.json.`);
        }
    }

    // A harness fault outranks a verdict that moved: the moved verdict cannot be
    // trusted until the fault is fixed. It also outranks "nothing changed", since a
    // grader that crashes while still reporting FAIL shows up as unchanged.
    process.exit(faults.length > 0 ? EXIT_GRADER_ERROR : changed > 0 ? EXIT_PRODUCT_FAILURE : EXIT_PASS);
}

main().catch((error: unknown) => {
    // Everything that gets here — a RegradeError, but also a JSON parse, sqlite or
    // filesystem failure — is the tool failing rather than a product verdict, so it
    // must exit 3. Node's default of 1 would read as "a verdict changed".
    console.error(error instanceof RegradeError ? error.message : error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(EXIT_GRADER_ERROR);
});
