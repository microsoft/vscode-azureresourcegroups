#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Reconstruct a checked-in **stage fixture** from a finished run, so gates can be exercised
 * against a realistic workspace without paying for an agent.
 *
 *   node harvest-stage.ts 2026083170541011 --stage scaffold
 *   node harvest-stage.ts --check
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────
 *
 * `grader-certification` already has fixtures, and they are broad — 18 of 21 wired gates
 * can be exercised offline. What they are not is *representative*.
 * `reference-node-fullstack` is a single package whose `src/server.js` serves its own
 * `public/`. Every project the scaffold agent actually emits is an npm-workspaces monorepo:
 * `services/functions` behind `func`, `services/web` behind its own Vite dev server, and
 * `services/shared` hoisted to the root `node_modules`.
 *
 * A gate can therefore be green in certification and near-zero in production, and nothing
 * connects the two numbers. Measured:
 *
 *   runtime-frontend-api   certification: green      production: 0 of 17
 *   runtime-frontend       certification: green      production: 1 of 11
 *   runtime-crud           certification: green      production: 1 of 11
 *
 * The `dependenciesInstalled` defect fixed in #1759 is the same shape: it could only occur
 * under workspace hoisting, and no fixture had workspaces, so certification could not see
 * it. Two paid runs found it instead.
 *
 * ── What a stage fixture is, and is not ──────────────────────────────────────────────
 *
 * An **input**, never an expected answer. `harvest-seed.ts` settled this argument already
 * and the reasoning carries over verbatim:
 *
 *   > the plan is an *input, not an expected answer*, so a stale one makes scaffold trials
 *   > fail **loudly** and cannot make a broken scaffolder look green. Fail-safe, not
 *   > fail-open.
 *
 * So a fixture that drifts from what the agent emits produces a red that gets investigated,
 * not a green that does not. `--check` reports drift explicitly rather than waiting for that.
 *
 * ── Where the content comes from ─────────────────────────────────────────────────────
 *
 * `patch.diff`, inside the run's `results.zip`. The container commits the base workspace and
 * the diff is everything the agent then wrote — which is exactly the set we want, and
 * already excludes the base image's own files. `node_modules`, `.github/agents` (the
 * instructions the phase preamble stages) and `.eval` (harness scratch) are dropped on top,
 * because none of them are agent output and `.github/agents` alone is 152 files.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const FIXTURES = join(REPO_ROOT, 'evals', 'grader-certification');

/** Paths the harness put in the workspace. Never agent output; see the header. */
const NOT_AGENT_OUTPUT = ['node_modules/', '.github/agents/', '.eval/', '.git/'];

interface HarvestProvenance {
    schemaVersion: number;
    stage: string;
    runId: string;
    harvestedAt: string;
    /** Paths written, sorted. The `--check` comparison is against this plus content. */
    files: string[];
    note: string;
}

function die(message: string): never {
    console.error(`ERROR: ${message}`);
    process.exit(1);
}

/**
 * Where msbench-cli writes results. Same order and semantics as `run.sh` and
 * `analyze-run.ts` — an explicit data dir first, then the AppDirs platform arms — so the
 * three cannot disagree about where a run lives.
 */
function resultsZipFor(runId: string, dataDir: string | undefined): string {
    const home = homedir();
    const candidates: string[] = [];
    if (dataDir) {
        candidates.push(join(dataDir, runId, 'results.zip'));
    }
    candidates.push(join(home, 'Library', 'Application Support', 'msbench', 'runs', runId, 'results.zip'));
    candidates.push(join(home, '.local', 'share', 'msbench', 'runs', runId, 'results.zip'));
    if (process.env.LOCALAPPDATA) {
        candidates.push(join(process.env.LOCALAPPDATA, 'Microsoft', 'msbench', 'runs', runId, 'results.zip'));
    }
    const found = candidates.find(candidate => existsSync(candidate));
    if (!found) {
        die(`no results.zip for run ${runId}. Looked in:\n  ${candidates.join('\n  ')}`);
    }
    return found;
}

/** Extract with whatever the host has. Destination is short: product log names overflow MAX_PATH. */
function extractZip(zip: string, into: string): void {
    mkdirSync(into, { recursive: true });
    try {
        execFileSync('unzip', ['-oq', zip, '-d', into], { stdio: 'ignore' });
        return;
    } catch {
        // fall through to PowerShell
    }
    try {
        execFileSync('powershell', ['-NoProfile', '-Command',
            `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${into}' -Force`], { stdio: 'ignore' });
    } catch {
        die(`could not extract ${zip}; neither unzip nor Expand-Archive succeeded`);
    }
}

function findFiles(root: string, match: (name: string) => boolean): string[] {
    const found: string[] = [];
    const stack = [root];
    while (stack.length > 0) {
        const dir = stack.pop()!;
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            } else if (match(entry.name)) {
                found.push(full);
            }
        }
    }
    return found;
}

interface ParsedPatch {
    created: Map<string, string>;
    /** Paths present in the patch that this reconstruction deliberately did not write. */
    skipped: { path: string; reason: string }[];
}

/**
 * Reconstruct created files from a git patch.
 *
 * Only `new file` entries are reconstructed, and that is a real limit rather than an
 * oversight: a modification hunk describes a *change* to a base this archive does not carry,
 * so the final content cannot be recovered from the diff alone. Anything not reconstructed
 * is reported rather than dropped, because a fixture silently missing a file the agent wrote
 * is a fixture that certifies a project nobody generated.
 */
function parsePatch(patch: string): ParsedPatch {
    const created = new Map<string, string>();
    const skipped: { path: string; reason: string }[] = [];
    // Split on the file headers, keeping each file's own block together.
    const blocks = patch.split(/^diff --git /m).slice(1);
    for (const block of blocks) {
        const header = /^a\/(\S+) b\/(\S+)/.exec(block);
        if (!header) {
            continue;
        }
        const path = header[2];
        if (NOT_AGENT_OUTPUT.some(prefix => path.startsWith(prefix))) {
            continue;
        }
        if (/^GIT binary patch$/m.test(block)) {
            skipped.push({ path, reason: 'binary patch' });
            continue;
        }
        if (!/^new file mode /m.test(block)) {
            skipped.push({ path, reason: 'modified, not created — final content is not recoverable from the diff' });
            continue;
        }
        const body = block.slice(block.indexOf('\n@@'));
        const lines: string[] = [];
        for (const line of body.split('\n')) {
            if (line.startsWith('@@') || line.startsWith('\\')) {
                continue;
            }
            if (line.startsWith('+')) {
                lines.push(line.slice(1));
            }
        }
        // A created file's hunk is entirely additions, so the joined `+` lines are the file.
        const noTrailingNewline = /^\\ No newline at end of file$/m.test(block);
        created.set(path, lines.join('\n') + (noTrailingNewline ? '' : '\n'));
    }
    return { created, skipped };
}

function harvestInto(runId: string, dataDir: string | undefined, destination: string): HarvestProvenance {
    const zip = resultsZipFor(runId, dataDir);
    const scratch = mkdtempSync(join(tmpdir(), 'cor-stage-'));
    try {
        extractZip(zip, scratch);
        for (const inner of findFiles(scratch, name => name.endsWith('-output.zip'))) {
            extractZip(inner, join(scratch, 'out'));
        }
        const patchPath = findFiles(scratch, name => name === 'patch.diff')[0];
        if (!patchPath) {
            die(`run ${runId} carries no patch.diff, so there is no agent output to harvest`);
        }
        const { created, skipped } = parsePatch(readFileSync(patchPath, 'utf8'));
        if (created.size === 0) {
            die(`run ${runId} created no files outside ${NOT_AGENT_OUTPUT.join(', ')} — nothing to harvest`);
        }

        rmSync(destination, { recursive: true, force: true });
        for (const [path, content] of [...created].sort(([a], [b]) => a.localeCompare(b))) {
            const target = join(destination, path);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, content);
        }
        for (const entry of skipped) {
            console.error(`  skipped ${entry.path} (${entry.reason})`);
        }
        return {
            schemaVersion: 1,
            stage: 'scaffold',
            runId,
            harvestedAt: new Date().toISOString(),
            files: [...created.keys()].sort(),
            note: 'Harvested from the run\'s patch.diff by evals/msbench/harvest-stage.ts. '
                + 'This is an INPUT to the gates, never an expected answer — see the header of that file. '
                + 'Re-harvest with: node evals/msbench/harvest-stage.ts <run-id> --stage scaffold',
        };
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

/**
 * Files the certification harness owns, which sit beside the harvest and are not agent
 * output. Excluded from `--check` so the harness's own metadata is never reported as drift
 * in the agent's tree.
 */
const HARNESS_OWNED = new Set(['harvest.json', 'scenario.json']);

/** Every file under `root`, workspace-relative and posix-separated. */
function listTree(root: string): Map<string, string> {
    const out = new Map<string, string>();
    if (!existsSync(root)) {
        return out;
    }
    for (const file of findFiles(root, () => true)) {
        const rel = relative(root, file).split(/[\\/]/).join('/');
        if (HARNESS_OWNED.has(rel)) {
            continue;
        }
        out.set(rel, readFileSync(file, 'utf8'));
    }
    return out;
}

function check(stage: string, dataDir: string | undefined): never {
    const destination = join(FIXTURES, `stage-${stage}`);
    const provenancePath = join(destination, 'harvest.json');
    if (!existsSync(provenancePath)) {
        die(`no harvested fixture at ${relative(REPO_ROOT, destination)}. Harvest one first.`);
    }
    const provenance = JSON.parse(readFileSync(provenancePath, 'utf8')) as HarvestProvenance;
    const scratch = mkdtempSync(join(tmpdir(), 'cor-check-'));
    try {
        harvestInto(provenance.runId, dataDir, scratch);
        const current = listTree(scratch);
        const checkedIn = listTree(destination);
        const problems: string[] = [];
        for (const [path, content] of current) {
            if (!checkedIn.has(path)) {
                problems.push(`  missing from the fixture: ${path}`);
            } else if (checkedIn.get(path) !== content) {
                problems.push(`  content differs: ${path}`);
            }
        }
        for (const path of checkedIn.keys()) {
            if (!current.has(path)) {
                problems.push(`  in the fixture but not in run ${provenance.runId}: ${path}`);
            }
        }
        if (problems.length > 0) {
            console.error(`stage-${stage} no longer matches run ${provenance.runId}:`);
            for (const problem of problems) {
                console.error(problem);
            }
            console.error('\nRe-harvest, or harvest a newer run:');
            console.error(`  node evals/msbench/harvest-stage.ts <run-id> --stage ${stage}`);
            process.exit(1);
        }
        console.log(`stage-${stage} matches run ${provenance.runId} (${checkedIn.size} file(s)), harvested ${provenance.harvestedAt}.`);
        process.exit(0);
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

function main(): void {
    const args = process.argv.slice(2);
    const stage = args.find(a => a.startsWith('--stage='))?.split('=')[1]
        ?? (args.includes('--stage') ? args[args.indexOf('--stage') + 1] : undefined)
        ?? 'scaffold';
    const dataDir = args.find(a => a.startsWith('--data-dir='))?.split('=')[1]
        ?? process.env.MSBENCH_DATA_DIR
        ?? undefined;

    if (args.includes('--check')) {
        check(stage, dataDir);
    }

    const runId = args.find(a => /^\d+$/.test(a));
    if (!runId) {
        console.error('usage: node harvest-stage.ts <run-id> [--stage scaffold] [--data-dir <path>]');
        console.error('       node harvest-stage.ts --check [--stage scaffold]');
        process.exit(1);
    }

    const destination = join(FIXTURES, `stage-${stage}`);
    const provenance = harvestInto(runId, dataDir, destination);
    provenance.stage = stage;
    writeFileSync(join(destination, 'harvest.json'), JSON.stringify(provenance, null, 4) + '\n');
    console.log(`Harvested ${provenance.files.length} file(s) from run ${runId} into ${relative(REPO_ROOT, destination)}`);
    const tops = new Map<string, number>();
    for (const file of provenance.files) {
        const top = file.split('/').slice(0, 2).join('/');
        tops.set(top, (tops.get(top) ?? 0) + 1);
    }
    for (const [top, count] of [...tops].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(count).padStart(3)}  ${top}`);
    }
}

main();
