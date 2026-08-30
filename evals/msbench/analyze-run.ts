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

const USAGE = 'usage: node analyze-run.ts <run-id> [--full]';

/** Verdict lines every grader emits, from graders/graderHarness.ts. */
const VERDICT = /^(PASS|FAIL|SKIP|NOT_APPLICABLE|NOT_ATTEMPTED|GRADER ERROR):?\s/;
/** The machine-readable attribution lines, which carry the reason code. */
const MARKER = /^(NOT_APPLICABLE|NOT_ATTEMPTED) gate=/;

function fail(message: string): never {
    console.error(`ERROR: ${message}`);
    process.exit(1);
}

/**
 * Where msbench-cli writes results. It uses AppDirs("msbench", "Microsoft"), so this is
 * platform-specific and the Windows arm is the one that matters here. Kept in the same order
 * run.sh checks them, so the two cannot disagree about where a run lives.
 */
function resultsZipFor(runId: string): string {
    const candidates: string[] = [];
    const home = os.homedir();
    if (process.env.LOCALAPPDATA) {
        candidates.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'msbench', 'runs', runId, 'results.zip'));
    }
    candidates.push(path.join(home, 'Library', 'Application Support', 'msbench', 'runs', runId, 'results.zip'));
    candidates.push(path.join(home, '.local', 'share', 'msbench', 'runs', runId, 'results.zip'));

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    fail(`no results.zip for run ${runId}. Looked in:\n  ${candidates.join('\n  ')}`);
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
    gate: string;
    exitCode: number;
    text: string;
}

function readGateRows(sqlitePath: string): GateRow[] {
    const db = new DatabaseSync(sqlitePath);
    try {
        const rows = db.prepare('SELECT command, exitCode, stdOut, stdErr, output FROM exec').all() as Array<{
            command: string;
            exitCode: number;
            stdOut: string | null;
            stdErr: string | null;
            output: string | null;
        }>;

        const byGate = new Map<string, GateRow>();
        for (const row of rows) {
            const matched = /validate-([a-z0-9-]+)\.ts/.exec(String(row.command));
            if (!matched) {
                continue;
            }
            // MSBench records the same exec twice for some steps. First writing wins; they carry
            // identical text, and printing a gate twice reads as two results.
            if (byGate.has(matched[1])) {
                continue;
            }
            const text = [row.stdOut, row.stdErr, row.output].filter(Boolean).join('\n').trim();
            byGate.set(matched[1], { gate: matched[1], exitCode: row.exitCode, text });
        }
        return [...byGate.values()];
    } finally {
        db.close();
    }
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

function main(): void {
    const args = process.argv.slice(2);
    if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
        console.log(USAGE);
        process.exit(args.length === 0 ? 1 : 0);
    }
    const full = args.includes('--full');
    const runId = args.find(a => !a.startsWith('-'));
    if (!runId) {
        fail(USAGE);
    }

    const zip = resultsZipFor(runId);
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

        const rows = readGateRows(sqlitePath).sort((a, b) => a.gate.localeCompare(b.gate));
        if (rows.length === 0) {
            fail('session.sqlite has no grader rows in its exec table; the graders may never have run');
        }

        console.log(`run ${runId} — ${rows.length} gate(s)\n`);
        const width = Math.max(...rows.map(r => r.gate.length));
        for (const row of rows) {
            const status = row.exitCode === 0 ? 'pass' : row.exitCode === 1 ? 'FAIL' : `exit ${row.exitCode}`;
            console.log(`${row.gate.padEnd(width)}  ${status}`);
            for (const line of describe(row, full)) {
                console.log(`    ${line}`);
            }
            console.log('');
        }

        const failed = rows.filter(r => r.exitCode !== 0);
        console.log(`${rows.length - failed.length} passed, ${failed.length} not passed`);
        console.log('\nThis is a report, not a verdict: check-assertions.ts owns whether the run is red.');
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}

main();
