#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Materialise the starting workspace a stimulus needs into `assets/workspace/`.
 *
 * The plan phase starts from an empty workspace, so nothing here was needed until the
 * scaffold and local-dev phases arrived. Those phases grade agents whose *first action*
 * is to read `.azure/project-plan.md`, so something has to put one there before turn 0.
 *
 * ── The interface: stimuli declare state, not mechanism ─────────────────────────────
 *
 * A stimulus names the workspace state it needs with a `# seed: <name>` header directive,
 * exactly parallel to `# phase:`. It never names a file path, a fixture, or a shell
 * command. This module resolves the name to a recipe and writes the result to
 * `assets/workspace/`; the phase `script:` copies `/agent/assets/workspace/.` into
 * `/workspace/` if it exists.
 *
 * That indirection is the point. Everything under `assets/` is uploaded with the run, so
 * "seeding" today means "copy a directory". If we later bake starting workspaces into
 * container images, or move to a private benchmark repository, the mechanism changes here
 * and the stimuli do not change at all.
 *
 * ── This module is the disposable one ──────────────────────────────────────────────
 *
 * Deliberately isolated and small, because it is the piece that gets DELETED if we take
 * the documented supported path instead: our own `dataset.jsonl` plus our own container
 * images, per the MSBench wiki page 5, *"Bring Your Own Benchmark Repository"*. That
 * route needs no PR into the eval repo and no approval from another team, and it makes
 * the starting workspace a property of the benchmark instance rather than something we
 * reconstruct with a `cp` in a `script:` block. It is named here so that the fork in the
 * road does not have to be rediscovered by whoever next asks "why is this a shell copy?".
 *
 * That claim has since been TESTED, and it held. `container/` builds an image in a
 * registry we own, pointed at by a `container_registry` column in our own
 * `dataset.jsonl`, and run 2026082777513216 ran the vscode agent inside it. No PR into
 * the eval repo, no approval from another team — the only prerequisite was granting the
 * CES service principal `AcrPull` on our registry, which we could do ourselves.
 *
 * So the fork in the road is now open, not hypothetical. What is still missing before
 * this module can be deleted is the *workspace* half: baking the starting workspace into
 * the image means it stops being a `cp` here and starts being a property of the instance.
 * See `container/README.md`.
 *
 * ── Why a checked-in fixture, when that was explicitly rejected once ────────────────
 *
 * The seed is the checked-in fixture at `evals/local-dev/fixtures/functions-postgres/`,
 * and it is worth being straight about the fact that this is the option a previous
 * design rejected. `harvest-seed.mjs` (commit cc75a4e1, not on `feat/CoR`) promoted a
 * finished `seed-plan-*` MSBench run into the scaffold suites' workspace precisely to
 * avoid this, and its header says why:
 *
 *   > Checking one in makes that document a second source of truth: edit the planner's
 *   > template and the stored copy still describes the old shape, so the scaffold graders
 *   > keep passing against a plan no agent would emit.
 *
 * That objection is real and is not answered here. What bounds it is the second of the
 * two properties that script relied on, quoted verbatim from the same header:
 *
 *   > 2. It is an *input, not an expected answer*. No scaffold grader reads the plan --
 *   > they assert against `resources/agents/**`. A wrong plan therefore makes scaffold
 *   > trials fail loudly; it cannot make them pass wrongly.
 *
 * So the drift risk is **fail-safe, not fail-open**: a stale plan makes real scaffold
 * runs go red for a bad reason, which is expensive and annoying — it cannot make a broken
 * scaffolder look green, which is the failure that would actually matter. We are
 * accepting a known cost to get the eight merged graders in front of real agent output
 * at all, not claiming the objection has gone away.
 *
 * What that leaves is a seed whose freshness nothing can vouch for, and
 * `harvest-seed.ts` is what closes it. `harvest-seed.mjs` had a `--check` mode that
 * reported seed freshness and exited 1 when stale, hashed against the planner's assets;
 * for a while nothing replaced it. Now:
 *
 *   node harvest-seed.ts <run-id>   promotes a real plan-phase run's document into
 *                                   `seeds/project-plan.md` with its provenance
 *   node harvest-seed.ts --check    compares the captured `agentAssetsHash` against
 *                                   `agent-assets.lock.json`, for free
 *
 * So the fixture below is the *floor*, not the only option: when a harvested plan is
 * present it wins, and when it is absent the fixture keeps the suite runnable on a
 * machine that has never talked to MSBench. See `config/stimuli/README.md`.
 *
 * ── Seed names ─────────────────────────────────────────────────────────────────────
 *
 * The names match `harvest-seed.mjs`'s TARGETS (`approved-fullstack`, `unapproved-plan`)
 * rather than inventing new ones, so switching this module to harvested seeds later is a
 * no-op at the stimulus level.
 *
 * Runs straight off source via Node's built-in type stripping — no build step.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARVESTED_PLAN, readProvenance } from './seed-store.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const STIMULI = join(HERE, 'config', 'stimuli');
const DEST = join(HERE, 'assets', 'workspace');

/**
 * The fallback fixture: a real, complete fullstack plan (React frontend, Azure Functions
 * backend, PostgreSQL) already used by `evals/local-dev/eval.yaml` for the same purpose.
 *
 * Used only when nothing has been harvested. `readPlanSource` prefers
 * `seeds/project-plan.md`, which carries provenance and can be checked for staleness.
 */
const PLAN_FIXTURE = join(HERE, '..', 'local-dev', 'fixtures', 'functions-postgres', '.azure', 'project-plan.md');

/** `# seed: approved-fullstack` anywhere in the stimulus header. Absent means `none`. */
const SEED_DIRECTIVE = /^#\s*seed:\s*([a-z0-9-]+)\s*$/im;

export const DEFAULT_SEED = 'none';

/** One workspace file: a container-workspace-relative path and its contents. */
interface SeededFile {
    readonly path: string;
    readonly content: string;
}

type Recipe = () => SeededFile[];

/**
 * `approved-fullstack` and `unapproved-plan` come from the *same* source document and
 * differ in the status line alone. That is load-bearing rather than tidy, and
 * `harvest-seed.mjs` stated the property better than a paraphrase would:
 *
 *   > One seed run feeds more than one scaffold suite. `approved-fullstack` and
 *   > `unapproved-plan` deliberately come from the *same* run: the pair is only
 *   > falsifiable if the sole difference is the approval status, so the scaffold agent
 *   > cannot pass both by keying off anything else in the document.
 *
 * Deriving the second from the first in code, rather than checking in two documents,
 * is what keeps that true — two files would drift in a second dimension the first time
 * one of them was edited, and the pair would quietly stop discriminating.
 */
const RECIPES: Record<string, Recipe> = {
    /**
     * Nothing. `scaffold-missing-plan` needs the plan to be genuinely absent, so this is
     * a real recipe rather than the absence of one — see `stageWorkspace` for why the
     * destination is cleared unconditionally either way.
     */
    none: () => [],

    'approved-fullstack': () => [
        { path: '.azure/project-plan.md', content: withStatus(readPlanSource(), 'Approved') },
    ],

    'unapproved-plan': () => [
        { path: '.azure/project-plan.md', content: withStatus(readPlanSource(), 'Planning') },
    ],
};

/** The plan document both seeds derive from, and where it came from. */
interface PlanSource {
    readonly path: string;
    readonly content: string;
    readonly harvested: boolean;
}

/**
 * Prefer a harvested plan, fall back to the checked-in fixture.
 *
 * The fallback is what keeps this runnable on a machine that has never authenticated to
 * MSBench — including CI before anyone has harvested — so the preference is a quality
 * upgrade rather than a new requirement.
 */
function readPlanSource(): PlanSource {
    if (existsSync(HARVESTED_PLAN)) {
        return { path: HARVESTED_PLAN, content: readFileSync(HARVESTED_PLAN, 'utf8'), harvested: true };
    }
    if (!existsSync(PLAN_FIXTURE)) {
        throw new Error(
            `No plan to seed from. Neither exists:\n` +
            `  harvested: ${HARVESTED_PLAN}\n` +
            `  fixture:   ${PLAN_FIXTURE}\n` +
            `Seeded stimuli derive every plan from one of them, so this is a hard error rather\n` +
            `than an empty seed.`
        );
    }
    return { path: PLAN_FIXTURE, content: readFileSync(PLAN_FIXTURE, 'utf8'), harvested: false };
}

/**
 * Rewrite the plan's status line, asserting that there was exactly one to rewrite.
 *
 * The assertion is the whole reason this is a function. A silent no-op here — the source
 * renamed the field, or reformatted the line — would produce an *approved* plan under the
 * name `unapproved-plan`, which turns `scaffold-unapproved-plan` into a second copy of
 * `scaffold-fullstack`. It would still read green, and the approval gate it exists to
 * test would simply stop being tested. Failing loudly on a developer machine costs
 * nothing; the alternative costs a paid run and reports a false pass.
 *
 * Both recipes go through it, including the approved one whose status is usually already
 * correct. That is deliberate: a harvested plan's status is whatever the agent left
 * behind, so normalising both directions is what keeps the pair's sole difference the
 * approval status — the property that makes the pair falsifiable at all.
 */
function withStatus(source: PlanSource, status: string): string {
    const statusLine = /^\*\*Status\*\*:\s*(.+)$/m;
    const matches = source.content.match(new RegExp(statusLine, 'gm')) ?? [];
    if (matches.length !== 1) {
        throw new Error(
            `Expected exactly one '**Status**: ...' line in ${source.path}, found ${matches.length}.\n` +
            `The seed recipes are produced by rewriting that line, and a silent no-op would make\n` +
            `stimuli/scaffold-unapproved-plan.yaml a duplicate of scaffold-fullstack.yaml that still\n` +
            `reports green while testing nothing.`
        );
    }
    return source.content.replace(statusLine, `**Status**: ${status}`);
}

/**
 * The paths a seed puts in the workspace, without writing anything.
 *
 * `build-config.ts` needs this to reject `files`-table assertions against seeded
 * paths: a seeded file never passes through the agent's tracked channel, so such
 * an assertion asks a question the table cannot answer. Exported separately from
 * `stageWorkspace` so that check stays a pure read.
 */
export function seedPaths(seed: string): string[] {
    const recipe = RECIPES[seed];
    if (!recipe) {
        throw new Error(`Unknown seed '${seed}'.`);
    }
    return recipe().map(file => file.path);
}

export function seedFor(stimulusText: string): string {
    return SEED_DIRECTIVE.exec(stimulusText)?.[1] ?? DEFAULT_SEED;
}

/**
 * Write the recipe out, having first removed anything a previous invocation left behind.
 *
 * The unconditional clear matters as much as the write: `assets/` is shared mutable state
 * reused across invocations (which is why run.sh takes a lock over it). Without this, a
 * `none` stimulus run after a seeded one would inherit the previous plan, and
 * `scaffold-missing-plan` — whose entire premise is that the plan is absent — would grade
 * an agent that could see one.
 */
export function stageWorkspace(seed: string): SeededFile[] {
    const recipe = RECIPES[seed];
    if (!recipe) {
        throw new Error(
            `Unknown seed '${seed}'. Available:\n${Object.keys(RECIPES).sort().map(name => `  ${name}`).join('\n')}`
        );
    }

    rmSync(DEST, { recursive: true, force: true });

    const files = recipe();
    for (const file of files) {
        const target = join(DEST, file.path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, file.content);
    }
    return files;
}

function main(): void {
    // Two callers, because two things can select a workspace. A hand-written stimulus
    // names its own seed; a stack-generated stimulus has no header to carry one, and the
    // phase file is what already owns the rest of its shape (`# turn-before:`), so it
    // owns the seed too. Splitting that would let a generated run scaffold against a
    // different starting workspace than the hand-written run of the same phase, which is
    // precisely the drift the phase file exists to prevent.
    const phaseFlag = process.argv.indexOf('--phase');
    if (phaseFlag !== -1) {
        const phase = process.argv[phaseFlag + 1];
        if (!phase) {
            console.error('usage: stage-workspace.ts --phase <phase>');
            process.exit(1);
        }
        const phasePath = join(HERE, 'config', 'phases', `${phase}.yaml`);
        if (!existsSync(phasePath)) {
            console.error(`Unknown phase '${phase}': ${phasePath} does not exist.`);
            process.exit(1);
        }
        stageAndReport(seedFor(readFileSync(phasePath, 'utf8')), `phase '${phase}'`);
        return;
    }

    const stimulus = process.argv[2];
    if (!stimulus) {
        console.error('usage: stage-workspace.ts <stimulus> | --phase <phase>');
        process.exit(1);
    }
    const stimulusPath = join(STIMULI, `${stimulus}.yaml`);
    if (!existsSync(stimulusPath)) {
        console.error(
            `Unknown stimulus '${stimulus}'. Available:\n` +
            readdirSync(STIMULI).filter(n => n.endsWith('.yaml')).map(n => `  ${n.replace(/\.yaml$/, '')}`).sort().join('\n')
        );
        process.exit(1);
    }

    stageAndReport(seedFor(readFileSync(stimulusPath, 'utf8')), `stimulus '${stimulus}'`);
}

function stageAndReport(seed: string, describedBy: string): void {
    let files: SeededFile[];
    try {
        files = stageWorkspace(seed);
    } catch (error) {
        console.error(`${(error as Error).message}`);
        process.exit(1);
    }

    if (files.length === 0) {
        console.log(`Seed '${seed}' for ${describedBy}: empty workspace (assets/workspace/ cleared)`);
        return;
    }
    console.log(`Staged seed '${seed}' for ${describedBy} to assets/workspace/`);
    for (const file of files) {
        console.log(`  ${file.path}`);
    }
    describePlanSource();
}

/**
 * Say where the plan came from, every time.
 *
 * A run seeded from a stale harvest and a run seeded from the fixture fail in the same
 * confusing way — an agent grading against a plan nobody would emit — and the only cheap
 * way to tell them apart afterwards is to have printed it at the time.
 */
function describePlanSource(): void {
    const source = readPlanSource();
    if (!source.harvested) {
        console.log('  plan source: checked-in fixture (nothing harvested; freshness unknown)');
        return;
    }
    const provenance = readProvenance();
    console.log(provenance
        ? `  plan source: harvested from run ${provenance.runId} at ${provenance.harvestedAt}`
        : `  plan source: ${HARVESTED_PLAN} (no provenance recorded)`);
}

// Only when run directly. build-config.ts imports `seedPaths`/`seedFor` from here,
// and a module that stages a workspace as a side effect of being imported would make
// that import silently destructive.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
