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
 * What we give up by not harvesting is also concrete: `harvest-seed.mjs` had a `--check`
 * mode that reported seed freshness and exited 1 when the seed was stale, hashed against
 * `resources/agents/**`. The checked-in fixture has no equivalent, so nothing detects the
 * drift automatically. See `config/stimuli/README.md`.
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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STIMULI = join(HERE, 'config', 'stimuli');
const DEST = join(HERE, 'assets', 'workspace');

/**
 * The one fixture every seed is derived from: a real, complete fullstack plan (React
 * frontend, Azure Functions backend, PostgreSQL) already used by
 * `evals/local-dev/eval.yaml` for the same purpose.
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
        { path: '.azure/project-plan.md', content: readPlanFixture() },
    ],

    'unapproved-plan': () => [
        { path: '.azure/project-plan.md', content: withStatus(readPlanFixture(), 'Planning') },
    ],
};

function readPlanFixture(): string {
    if (!existsSync(PLAN_FIXTURE)) {
        throw new Error(
            `The plan fixture is missing: ${PLAN_FIXTURE}\n` +
            `Seeded stimuli derive every plan from it, so this is a hard error rather than an empty seed.`
        );
    }
    return readFileSync(PLAN_FIXTURE, 'utf8');
}

/**
 * Rewrite the plan's status line, asserting that there was exactly one to rewrite.
 *
 * The assertion is the whole reason this is a function. A silent no-op here — the fixture
 * renamed the field, or reformatted the line — would produce an *approved* plan under the
 * name `unapproved-plan`, which turns `scaffold-unapproved-plan` into a second copy of
 * `scaffold-fullstack`. It would still read green, and the approval gate it exists to
 * test would simply stop being tested. Failing loudly on a developer machine costs
 * nothing; the alternative costs a paid run and reports a false pass.
 */
function withStatus(plan: string, status: string): string {
    const statusLine = /^\*\*Status\*\*:\s*(.+)$/m;
    const matches = plan.match(new RegExp(statusLine, 'gm')) ?? [];
    if (matches.length !== 1) {
        throw new Error(
            `Expected exactly one '**Status**: ...' line in ${PLAN_FIXTURE}, found ${matches.length}.\n` +
            `The unapproved seed is produced by rewriting that line, and a silent no-op would make\n` +
            `stimuli/scaffold-unapproved-plan.yaml a duplicate of scaffold-fullstack.yaml that still\n` +
            `reports green while testing nothing.`
        );
    }
    return plan.replace(statusLine, `**Status**: ${status}`);
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
    const stimulus = process.argv[2];
    if (!stimulus) {
        console.error('usage: stage-workspace.ts <stimulus>');
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

    const seed = seedFor(readFileSync(stimulusPath, 'utf8'));
    let files: SeededFile[];
    try {
        files = stageWorkspace(seed);
    } catch (error) {
        console.error(`${(error as Error).message}`);
        process.exit(1);
    }

    if (files.length === 0) {
        console.log(`Seed '${seed}' for stimulus '${stimulus}': empty workspace (assets/workspace/ cleared)`);
        return;
    }
    console.log(`Staged seed '${seed}' for stimulus '${stimulus}' to assets/workspace/`);
    for (const file of files) {
        console.log(`  ${file.path}`);
    }
}

main();
