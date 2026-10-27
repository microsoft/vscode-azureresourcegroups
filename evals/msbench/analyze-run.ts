/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Print what every gate actually said in a finished run.
 *
 * ## Why this exists
 *
 * A grader's verdict line — the sentence naming the file that was missing, the reason code, the
 * stack trace from the app that would not start — is written to stdout/stderr and captured
 * **only** in `output/vsc-output/session.sqlite`, in the `exec` table's `stdOut`/`stdErr`/
 * `output` columns. It is not in `entry.log`, which records the command and its exit code and
 * nothing else. It is not in the run log, the full run log, `eval.json`, or `custom_metrics.json`.
 *
 * That is worth stating plainly because not knowing it is expensive. Investigating run
 * 2026083057881445 meant grepping every text file in the extracted results for the reason
 * codes, finding nothing, and concluding — wrongly, for a while — that the diagnostics were
 * simply not captured. They were, one table away.
 *
 * ## The other reason
 *
 * `run.sh` runs `verify-run.ts` and `check-assertions.ts` itself, on the results of the run it
 * just submitted. That is the right place for them, but it means those checks are reachable
 * only through a live invocation: if the shell dies, or the run is submitted from CI, or
 * someone wants a second look at a run from last week, there is no entry point. Losing the
 * parent process of run 2026083057881445 lost its post-run analysis with it, even though the
 * run itself completed and its results were sitting on disk the whole time.
 *
 * So this reads a run that already happened, by id, for zero tokens.
 *
 * Usage:
 *   node analyze-run.ts 2026083057881445
 *   node analyze-run.ts 2026083057881445 --full     # whole captured output, not just verdicts
 *   node analyze-run.ts 2026083057881445 --data-dir /tmp/runs   # a run submitted with --data_dir
 *
 * Exit codes are deliberately NOT the run's verdict — `check-assertions.ts` owns that. This
 * exits 0 when it could read the run and 1 when it could not, so "the report printed" and "the
 * run passed" can never be confused.
 */

import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const USAGE = 'usage: node analyze-run.ts <run-id> [--full] [--data-dir <path>]';

/** Verdict lines every grader emits, from graders/graderHarness.ts. */
const VERDICT = /^(PASS|FAIL|SKIP|NOT_APPLICABLE|NOT_ATTEMPTED|GRADER ERROR):?\s/;
/** The machine-readable attribution lines, which carry the reason code. */
const MARKER = /^(NOT_APPLICABLE|NOT_ATTEMPTED) gate=/;

function fail(message: string): never {
    console.error(`ERROR: ${message}`);
    process.exit(1);
}

/**
 * Where msbench-cli writes results.
 *
 * `--data_dir` overrides the platform default outright, and results then land at
 * `<data_dir>/<run_id>/results.zip` — with no `runs` component, because the default already
 * ends in one. A reader that knows only the defaults finds nothing for any run submitted
 * that way, and that is precisely the case this tool exists for: a run submitted from CI, or
 * by someone else, is the run you cannot recover by re-running `run.sh`. The README records
 * the same lesson under "`--data_dir` moves where results land, and anything that reads them
 * must follow".
 *
 * Order and semantics are copied from `run.sh`'s own lookup so the two cannot disagree about
 * where a run lives: explicit data dir first, then the AppDirs("msbench", "Microsoft")
 * platform arms. `MSBENCH_DATA_DIR` is accepted too, because that is the spelling
 * `gate-health.ts` reads.
 */
function resultsZipFor(runId: string, dataDir: string | undefined): string {
    const candidates: string[] = [];
    const home = os.homedir();
    if (dataDir) {
        candidates.push(path.join(dataDir, runId, 'results.zip'));
    }
    candidates.push(path.join(home, 'Library', 'Application Support', 'msbench', 'runs', runId, 'results.zip'));
    candidates.push(path.join(home, '.local', 'share', 'msbench', 'runs', runId, 'results.zip'));
    if (process.env.LOCALAPPDATA) {
        candidates.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'msbench', 'runs', runId, 'results.zip'));
    }

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    fail(
        `no results.zip for run ${runId}. Looked in:\n  ${candidates.join('\n  ')}`
        + (dataDir
            ? ''
            : '\n\nIf the run was submitted with --data_dir, results are not in any of these.'
            + '\nPass the same path here with --data-dir, or set MSBENCH_DATA_DIR.'),
    );
}

/**
 * Extract with whatever the host has. `unzip` on a POSIX-ish host, PowerShell otherwise.
 *
 * The destination is a SHORT path (see caller) rather than somewhere convenient, because the
 * results contain product log filenames long enough to exceed Windows' 260-character limit
 * once nested under a repo path — which is exactly how `msbench-cli extract` fails when it is
 * pointed at `evals/msbench/.regrade/<run-id>/`.
 */
function extractZip(zip: string, into: string): void {
    fs.mkdirSync(into, { recursive: true });
    const unzip = spawnSync('unzip', ['-oq', zip, '-d', into], { stdio: 'ignore' });
    if (unzip.status === 0) {
        return;
    }
    const ps = spawnSync(
        'powershell',
        ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${into}' -Force`],
        { stdio: 'ignore' },
    );
    if (ps.status !== 0) {
        fail(`could not extract ${zip}; neither unzip nor PowerShell Expand-Archive succeeded`);
    }
}

function findFile(root: string, name: string): string | undefined {
    const stack = [root];
    while (stack.length > 0) {
        const dir = stack.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            } else if (entry.name === name) {
                return full;
            }
        }
    }
    return undefined;
}

function findFilesEndingWith(root: string, suffix: string): string[] {
    const found: string[] = [];
    const stack = [root];
    while (stack.length > 0) {
        const dir = stack.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            } else if (entry.name.endsWith(suffix)) {
                found.push(full);
            }
        }
    }
    return found;
}

interface GateRow {
    /** Grader name plus whatever arguments distinguish this invocation from another. */
    label: string;
    exitCode: number;
    text: string;
}

interface ExecRow {
    command: string;
    exitCode: number;
    stdOut: string | null;
    stdErr: string | null;
    output: string | null;
}

function textOf(row: ExecRow): string {
    return [row.stdOut, row.stdErr, row.output].filter(Boolean).join('\n').trim();
}

function readExecRows(sqlitePath: string): ExecRow[] {
    const db = new DatabaseSync(sqlitePath);
    try {
        return db.prepare('SELECT command, exitCode, stdOut, stdErr, output FROM exec').all() as unknown as ExecRow[];
    } finally {
        db.close();
    }
}

/**
 * One row per distinct grader *invocation*.
 *
 * Keyed on the whole command rather than the grader filename, because the same grader
 * legitimately runs more than once in a turn with different arguments:
 * `redteam-insecure-defaults.yaml` invokes `validate-safety-boundaries.ts` twice, once with
 * `--expect publicAnonymousAccess` and once with `--expect subscriptionOwnerGrant`. Under a
 * filename key the second verdict was dropped — not just from the listing but from the
 * pass/fail tally at the bottom — and a report that silently omits a verdict is worse than
 * no report, because it reads as complete.
 *
 * Identical commands still collapse: MSBench records the same exec twice for some steps, they
 * carry identical text, and printing a gate twice reads as two results.
 */
function readGateRows(rows: ExecRow[]): GateRow[] {
    const byInvocation = new Map<string, GateRow>();
    for (const row of rows) {
        const command = String(row.command).replace(/\s+/g, ' ').trim();
        const matched = /validate-([a-z0-9-]+)\.ts(.*)$/.exec(command);
        if (!matched) {
            continue;
        }
        if (byInvocation.has(command)) {
            continue;
        }
        // The arguments are the only thing telling two invocations of one grader apart, so
        // they belong in the label; without them both rows would print under the same name.
        const args = matched[2].trim();
        byInvocation.set(command, {
            label: args ? `${matched[1]} ${args}` : matched[1],
            exitCode: row.exitCode,
            text: textOf(row),
        });
    }
    return [...byInvocation.values()];
}

/**
 * The `exec:` assertions that are not graders — environment fingerprints, directory listings,
 * emulator port probes.
 *
 * Worth printing, and the omission was found by using this tool on the run it was written for.
 * A stimulus that probes whether PostgreSQL is listening *before* the CRUD gate runs is doing
 * so precisely to separate "the gate is broken" from "the datastore was never there", and a
 * report that hides that line throws away the disambiguation it was written to provide.
 */
function readTriageRows(rows: ExecRow[]): ExecRow[] {
    const seen = new Set<string>();
    const triage: ExecRow[] = [];
    for (const row of rows) {
        const command = String(row.command);
        if (/validate-[a-z0-9-]+\.ts/.test(command) || seen.has(command)) {
            continue;
        }
        seen.add(command);
        triage.push(row);
    }
    return triage;
}

function describe(row: GateRow, full: boolean): string[] {
    if (full) {
        return row.text ? row.text.split('\n') : ['(no captured output)'];
    }
    const lines = row.text.split('\n').map(line => line.trim());
    const verdicts = lines.filter(line => VERDICT.test(line) || MARKER.test(line));
    if (verdicts.length > 0) {
        // Deduplicated for the same reason as the rows above: the marker line and the human line
        // are both wanted, but each only once.
        return [...new Set(verdicts)];
    }
    return ['(no verdict line; re-run with --full)'];
}

interface Options {
    readonly runId: string;
    readonly full: boolean;
    readonly dataDir?: string;
}

/**
 * Parsed rather than sniffed with `includes`/`find`.
 *
 * `--data-dir` takes a value, and a positional scan that only skipped things starting with
 * `-` would happily read `C:\msbench-runs` as the run id on Windows. Both spellings are
 * accepted because `run.sh` accepts both, and an unknown option is refused rather than
 * ignored — a silently-dropped flag is how the caller ends up reading the wrong run.
 */
function parseOptions(argv: string[]): Options {
    let runId: string | undefined;
    let full = false;
    let dataDir = process.env.MSBENCH_DATA_DIR || undefined;

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--full') {
            full = true;
            continue;
        }
        const inline = /^--data[-_]dir=(.+)$/.exec(arg);
        if (inline) {
            dataDir = inline[1];
            continue;
        }
        if (arg === '--data-dir' || arg === '--data_dir') {
            const value = argv[++index];
            if (!value) {
                fail(`--data-dir needs a value.\n${USAGE}`);
            }
            dataDir = value;
            continue;
        }
        if (arg.startsWith('-')) {
            fail(`unknown option ${arg}.\n${USAGE}`);
        }
        if (runId !== undefined) {
            fail(`more than one run id given (${runId}, ${arg}).\n${USAGE}`);
        }
        runId = arg;
    }

    if (runId === undefined) {
        fail(USAGE);
    }
    return { runId, full, dataDir };
}

function main(): void {
    const args = process.argv.slice(2);
    if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
        console.log(USAGE);
        process.exit(args.length === 0 ? 1 : 0);
    }
    const { runId, full, dataDir } = parseOptions(args);

    const zip = resultsZipFor(runId, dataDir);
    // os.tmpdir(), not the repo: see extractZip. A repo-relative destination is what makes the
    // long product-log filenames overflow MAX_PATH on Windows.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cor-run-'));
    try {
        extractZip(zip, scratch);
        for (const inner of findFilesEndingWith(scratch, '-output.zip')) {
            extractZip(inner, path.join(scratch, 'out'));
        }

        const sqlitePath = findFile(scratch, 'session.sqlite');
        if (!sqlitePath) {
            fail(`extracted ${zip} but found no session.sqlite, so no gate output can be read`);
        }

        const execRows = readExecRows(sqlitePath);
        const rows = readGateRows(execRows).sort((a, b) => a.label.localeCompare(b.label));
        if (rows.length === 0) {
            fail('session.sqlite has no grader rows in its exec table; the graders may never have run');
        }

        console.log(`run ${runId} — ${rows.length} grader invocation(s)\n`);
        const width = Math.max(...rows.map(r => r.label.length));
        for (const row of rows) {
            const status = row.exitCode === 0 ? 'pass' : row.exitCode === 1 ? 'FAIL' : `exit ${row.exitCode}`;
            console.log(`${row.label.padEnd(width)}  ${status}`);
            for (const line of describe(row, full)) {
                console.log(`    ${line}`);
            }
            console.log('');
        }

        const triage = readTriageRows(execRows);
        if (triage.length > 0) {
            console.log('triage execs (not gates):\n');
            for (const row of triage) {
                const command = String(row.command).replace(/\s+/g, ' ').trim();
                console.log(`  $ ${command.length > 100 ? `${command.slice(0, 100)}…` : command}`);
                const lines = textOf(row).split('\n').filter(Boolean);
                for (const line of full ? lines : lines.slice(0, 8)) {
                    console.log(`      ${line.trim()}`);
                }
                if (!full && lines.length > 8) {
                    console.log(`      … ${lines.length - 8} more line(s); re-run with --full`);
                }
                console.log('');
            }
        }

        const failed = rows.filter(r => r.exitCode !== 0);
        console.log(`${rows.length - failed.length} passed, ${failed.length} not passed`);
        console.log('\nThis is a report, not a verdict: check-assertions.ts owns whether the run is red.');
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}

main();
