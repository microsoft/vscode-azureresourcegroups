#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Promote a finished plan-phase run's `.azure/project-plan.md` into the scaffold seed,
 * and report when that seed has gone stale.
 *
 *   node harvest-seed.ts 2026082614813342     # harvest a real plan from a real run
 *   node harvest-seed.ts --check              # is the harvested seed still current?
 *
 * ── The problem this closes ────────────────────────────────────────────────────────
 *
 * The scaffold and local-dev phases need an approved `.azure/project-plan.md` on disk
 * before turn 0, and until now it was a checked-in fixture. `stage-workspace.ts`
 * documents the objection to that, quoting the design that rejected it first:
 *
 *   > Checking one in makes that document a second source of truth: edit the planner's
 *   > template and the stored copy still describes the old shape, so the scaffold graders
 *   > keep passing against a plan no agent would emit.
 *
 * The objection is bounded rather than answered — the plan is an *input, not an expected
 * answer*, so a stale one makes scaffold trials fail **loudly** and cannot make a broken
 * scaffolder look green. Fail-safe, not fail-open.
 *
 * But one thing was given up outright: the original `harvest-seed.mjs` had a `--check`
 * that reported seed freshness and exited 1 when stale, and **nothing replaced it**. So
 * the fixture could drift from what the planner emits with no symptom but an expensive,
 * confusing red run. This restores both halves — the harvest and the check.
 *
 * ── Why the check is free, and why it hashes the agent rather than the plan ─────────
 *
 * A plan's shape is determined by the planner's instructions. So "is this stored plan
 * still representative?" is really "have the planner's instructions changed since it was
 * captured?" — and that is answerable locally, with no run, no model and no network.
 *
 * Harvesting records `agent-assets.lock.json`'s `agentAssetsHash` alongside the document;
 * `--check` compares it against the lock today. See `seed-store.ts` for why the lock is
 * read rather than recomputed.
 *
 * Note that this over-triggers slightly — the hash covers the planner's whole asset tree,
 * so an edit that cannot change the plan's shape still marks the seed stale. That is the
 * intended direction. Missing a real drift is fail-open; re-harvesting unnecessarily
 * costs one free extraction.
 *
 * ── Exit codes ─────────────────────────────────────────────────────────────────────
 *
 *   0 — the harvested seed is current
 *   1 — the harvested seed is stale: the planner's assets changed since it was captured
 *   2 — nothing has been harvested, so the checked-in fixture is in use and its
 *       freshness is *unknown*
 *   3 — the tool itself could not run
 *
 * Exit 2 is deliberately neither 0 nor 1, for the reason #1747 settled for gates: a check
 * that never ran is not the same as a check that passed, and collapsing them is how "we
 * could not tell" starts reading as "it passed". It is separate from 1 because the two
 * want different actions — 1 means re-harvest, 2 means nobody has started.
 *
 * Runs straight off source via Node's built-in type stripping — no build step. Needs
 * `--disable-warning=ExperimentalWarning` for `node:sqlite`; `npm run seed:harvest` and
 * `npm run seed:check` pass it.
 */

import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { findInstances, matchesInstance, MsBenchToolError, resolveExtraction, type Instance } from './extraction.ts';
import {
    checkFreshness, currentAgentAssetsHash, EXIT_FRESH, EXIT_NOT_HARVESTED, EXIT_STALE, EXIT_TOOL_ERROR,
    HARVESTED_PLAN, PROVENANCE_PATH, writeSeed, type Freshness, type Provenance,
} from './seed-store.ts';

/** Anchored to the `.azure/` directory so a stray `docs/project-plan.md` cannot match. */
const PLAN_PATH = '.azure/project-plan.md';

const USAGE = `Promote a plan-phase run's .azure/project-plan.md into the scaffold seed.

Usage:
  node harvest-seed.ts <run-id> [--instance <id>]
  node harvest-seed.ts <run-id> --extracted <dir>
  node harvest-seed.ts --check

Options:
  --instance <id>   Pick one instance when the run holds several.
  --extracted <dir> Harvest from an already-extracted directory instead of
                    downloading. The run id is still required, because
                    provenance that cannot name its run is not auditable.
  --check           Report whether the harvested seed is still current, and exit
                    0 (fresh) / 1 (stale) / 2 (never harvested).
  -h, --help        Show this help.

Harvesting requires \`msbench-cli\` on PATH; --check is purely local:
  export PATH="$HOME/.msbench-venv/bin:$PATH"`;

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function reportFreshness(freshness: Freshness): number {
    switch (freshness.state) {
        case 'not-harvested':
            console.log('Seed: not harvested.');
            console.log(`  No ${PROVENANCE_PATH}, so the scaffold phase uses the checked-in fixture at`);
            console.log('  evals/local-dev/fixtures/functions-postgres/.azure/project-plan.md.');
            console.log('  That fixture is fail-safe, but its freshness is unknown. To fix that:');
            console.log('    npm run seed:harvest -- <plan-run-id>');
            return EXIT_NOT_HARVESTED;

        case 'stale':
            console.log('Seed: STALE.');
            console.log(`  Harvested from run ${freshness.provenance.runId} at ${freshness.provenance.harvestedAt}`);
            console.log(`    captured agentAssetsHash: ${freshness.provenance.agentAssetsHash}`);
            console.log(`    current  agentAssetsHash: ${freshness.current}`);
            console.log("  The planner's assets changed since this plan was captured, so it may describe");
            console.log('  a shape the planner would no longer emit. Re-harvest from a run made against');
            console.log('  the current agents.');
            return EXIT_STALE;

        case 'fresh':
            console.log('Seed: current.');
            console.log(`  Harvested from run ${freshness.provenance.runId} at ${freshness.provenance.harvestedAt}`);
            console.log(`  agentAssetsHash ${freshness.provenance.agentAssetsHash} matches the lock.`);
            return EXIT_FRESH;
    }
}

// ---------------------------------------------------------------------------
// Harvest
// ---------------------------------------------------------------------------

function selectInstance(root: string, wanted: string | undefined): Instance {
    const { instances, incomplete } = findInstances(root);
    const describeIncomplete = incomplete.length
        ? `\nInstances with no session.sqlite (output blob never arrived): ${incomplete.join(', ')}`
        : '';

    if (instances.length === 0) {
        throw new MsBenchToolError(`No instance output found under ${root}.${describeIncomplete}`);
    }

    const candidates = wanted
        ? instances.filter(instance => matchesInstance(instance.name, wanted))
        : instances;

    if (candidates.length === 0) {
        throw new MsBenchToolError(
            `No instance matches '${wanted}'. Available:\n` +
            instances.map(instance => `  ${instance.name}`).join('\n') + describeIncomplete
        );
    }
    // Refuse to guess. Picking the first of several would silently decide whose plan
    // becomes the seed for everyone, and the provenance file would then record that
    // accident as though it had been a deliberate choice.
    if (candidates.length > 1) {
        throw new MsBenchToolError(
            `${candidates.length} instances match${wanted ? ` '${wanted}'` : ''}. Narrow with --instance:\n` +
            candidates.map(instance => `  ${instance.name}`).join('\n')
        );
    }
    return candidates[0];
}

/**
 * Pull the run's final `.azure/project-plan.md` out of the `files` table.
 *
 * Highest `stepIndex` wins, which is the document as it stood when the run ended — the
 * same rule `regrade.ts` uses to rebuild a whole workspace.
 */
function readPlanFromRun(instance: Instance): { path: string; content: string } {
    const db = new DatabaseSync(instance.sqlitePath, { readOnly: true });
    try {
        const total = (db.prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number }).n;
        // "The table is empty" and "the agent wrote no plan" are different findings with
        // different fixes, and an empty table makes every path query vacuously unhelpful.
        // Saying which one happened is the difference between a five-minute fix and an
        // afternoon.
        if (total === 0) {
            throw new MsBenchToolError(
                `${instance.name}: the files table is empty.\n` +
                'That means the run captured no workspace at all — a phase with\n' +
                '`snapshotWorkspace: false`, or a run that produced nothing — rather than an agent\n' +
                'that declined to write a plan. Harvest from a plan-phase run.'
            );
        }

        const rows = db.prepare('SELECT path, content, stepIndex FROM files ORDER BY stepIndex ASC, id ASC')
            .all() as { path: string; content: string; stepIndex: number }[];

        const latest = new Map<string, string>();
        for (const row of rows) {
            latest.set(row.path, row.content);
        }

        const matches = [...latest].filter(([path]) => path === PLAN_PATH || path.endsWith(`/${PLAN_PATH}`));
        if (matches.length === 0) {
            throw new MsBenchToolError(
                `${instance.name}: no ${PLAN_PATH} among the ${latest.size} file(s) the agent wrote.\n` +
                'The run reached the agent but it never produced a plan, so there is nothing to\n' +
                'promote. Harvest from a run whose plan assertion passed.'
            );
        }
        if (matches.length > 1) {
            throw new MsBenchToolError(
                `${instance.name}: ${matches.length} candidate plans, so which one is the seed is ambiguous:\n` +
                matches.map(([path]) => `  ${path}`).join('\n')
            );
        }

        const [path, content] = matches[0];
        return { path, content };
    } finally {
        db.close();
    }
}

/**
 * Fail here rather than at staging time.
 *
 * `stage-workspace.ts` derives both seeds by rewriting the single `**Status**:` line, and
 * asserts there is exactly one to rewrite — because a silent no-op there turns the
 * unapproved stimulus into a duplicate of the approved one that still reports green. A
 * harvested document that cannot satisfy that guard has to be rejected now, on a
 * developer machine, rather than when a paid run is already staging.
 */
function assertPlanIsUsable(content: string, source: string): void {
    const matches = content.match(/^\*\*Status\*\*:\s*(.+)$/gm) ?? [];
    if (matches.length !== 1) {
        throw new MsBenchToolError(
            `The harvested plan has ${matches.length} '**Status**: ...' lines; exactly one is required.\n` +
            `  source: ${source}\n` +
            'Both seed recipes are produced by rewriting that line, so a document without exactly\n' +
            'one of them would make scaffold-unapproved-plan a silent duplicate of\n' +
            'scaffold-fullstack that still reports green while testing nothing.'
        );
    }
}

function harvest(runId: string, wanted: string | undefined, extractedDir: string | undefined): void {
    const root = resolveExtraction({ runId, instance: wanted, extractedDir });
    const instance = selectInstance(root, wanted);
    const { path, content } = readPlanFromRun(instance);
    assertPlanIsUsable(content, `${instance.name} ${path}`);

    const provenance: Provenance = {
        runId,
        instance: instance.name,
        harvestedAt: new Date().toISOString(),
        agentAssetsHash: currentAgentAssetsHash(),
        sourcePath: path,
    };
    writeSeed(content, provenance);

    console.log(`Harvested ${path} from ${instance.name}`);
    console.log(`  -> ${HARVESTED_PLAN} (${content.length} bytes)`);
    console.log(`  -> ${PROVENANCE_PATH}`);
    console.log(`  agentAssetsHash ${provenance.agentAssetsHash}`);
    console.log('');
    console.log('The scaffold and local-dev phases now seed from real planner output.');
    console.log('Commit both files: a seed only helps CI if it travels with the repository.');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): number {
    const argv = process.argv.slice(2);
    let runId: string | undefined;
    let instance: string | undefined;
    let extractedDir: string | undefined;
    let check = false;

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        switch (arg) {
            case '-h': case '--help':
                console.log(USAGE);
                return EXIT_FRESH;
            case '--check':
                check = true;
                break;
            case '--instance': {
                const value = argv[++index];
                if (value === undefined) {
                    throw new MsBenchToolError('--instance needs a value');
                }
                instance = value;
                break;
            }
            case '--extracted': {
                const value = argv[++index];
                if (value === undefined) {
                    throw new MsBenchToolError('--extracted needs a value');
                }
                extractedDir = value;
                break;
            }
            default:
                if (arg.startsWith('-')) {
                    throw new MsBenchToolError(`Unknown option ${arg}\n\n${USAGE}`);
                }
                if (runId) {
                    throw new MsBenchToolError(`Unexpected second run id '${arg}'`);
                }
                runId = arg;
        }
    }

    if (check) {
        if (runId) {
            throw new MsBenchToolError('--check reports on the stored seed and takes no run id.');
        }
        return reportFreshness(checkFreshness());
    }

    // Required even with `--extracted`. The provenance file's whole job is to say which
    // run a seed came from, and one that recorded a local directory path instead would
    // be unauditable on any other machine.
    if (!runId) {
        throw new MsBenchToolError(`Give a run id to harvest, or --check.\n\n${USAGE}`);
    }
    harvest(runId, instance, extractedDir);
    return EXIT_FRESH;
}

// Only when run directly — importing this module must not extract a run as a side effect.
// `stage-workspace.ts` deliberately imports `seed-store.ts` instead of this file, so that
// staging never pulls in `node:sqlite`.
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
    try {
        process.exit(main());
    } catch (error) {
        console.error(error instanceof MsBenchToolError ? error.message : error instanceof Error ? (error.stack ?? error.message) : String(error));
        process.exit(EXIT_TOOL_ERROR);
    }
}
