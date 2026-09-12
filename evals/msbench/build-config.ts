#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Build `assets/user-overrides.yaml` for one stimulus.
 *
 * `scripts/run-agent.sh` in microsoft/vscode-copilot-evaluation does a literal
 * `cp "$PWD/user-overrides.yaml"`, so that filename is the only config the agent
 * will ever read — a stimulus cannot be selected with a flag. And `promptSteps`
 * feeds a *single* chat session, so the stimuli cannot be stacked into one file
 * either: a later one would see the requirements.json an earlier one wrote, and
 * `no-premature-plan` would fail spuriously. One run per stimulus is therefore
 * forced, and the only real choice is whether the shared preamble is copied into
 * four files or written once. It is written once, here.
 *
 * Three layers are concatenated, not two:
 *
 *   config/base.yaml  ->  config/phases/<phase>.yaml  ->  config/stimuli/<name>.yaml
 *
 * The middle layer exists because the product's phases are not interchangeable.
 * The plan phase starts from an empty workspace; the scaffold phase needs an
 * approved `.azure/project-plan.md` already on disk and must not snapshot the
 * workspace, because it runs a real `npm install` and would copy node_modules
 * into session.sqlite after every step; the local-dev phase needs a whole
 * scaffolded project. Those differences are `chatMode`, `script:` and
 * `snapshotWorkspace` — shared by every stimulus in a phase, and different
 * between phases. Without this layer they would be copied into each stimulus,
 * which is how identical blocks drift apart.
 *
 * A stimulus selects its phase with a `# phase: <name>` directive; omitting it
 * means `plan`, so the original stimuli did not have to change. The parallel
 * `# seed: <name>` directive selects the *starting workspace* and is resolved by
 * `stage-workspace.ts`, not here — it produces a directory, not config.
 *
 * The merge is deliberately textual rather than a YAML round-trip. The three
 * files define disjoint top-level keys, so concatenation is sufficient — and it
 * keeps every explanatory comment intact in the generated file, which a
 * parse-and-serialise would silently drop. The result is parsed afterwards
 * purely to prove the concatenation produced valid YAML.
 *
 * Runs straight off source via Node's built-in type stripping — no build step.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DISK_TRIAGE_COMMENT, FINGERPRINT_COMMENT, SENTINEL_COMMENT } from './assertionIdentity.ts';
import type { PhaseWiring } from '../src/gateWiring.ts';
import type { Stack } from '../src/stack.ts';
import { seedFor, seedPaths } from './stage-workspace.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const CONFIG = join(HERE, 'config');
const STIMULI = join(CONFIG, 'stimuli');
const PHASES = join(CONFIG, 'phases');
const STACKS = join(CONFIG, 'stacks');
const ASSETS = join(HERE, 'assets');
const DEST = join(ASSETS, 'user-overrides.yaml');

/**
 * The resolved stack, projected as JSON for the container.
 *
 * JSON rather than the YAML source because the graders run from staged source
 * with no `node_modules` — `stage-graders.ts` refuses anything reachable from a
 * bare specifier, and the stack loader needs the `yaml` package. Written beside
 * the graders rather than inside `assets/graders/` so it cannot be erased by
 * `stage-graders.ts`, which wipes that directory on every run.
 */
const PROJECTION = join(ASSETS, 'stack.json');

export const DEFAULT_STIMULUS = 'photo-app-requirements';
export const DEFAULT_PHASE = 'plan';

/** `# phase: scaffold` anywhere in the stimulus header. */
const PHASE_DIRECTIVE = /^#\s*phase:\s*([a-z0-9-]+)\s*$/im;

function available(): string[] {
    return readdirSync(STIMULI)
        .filter(name => name.endsWith('.yaml'))
        .map(name => name.replace(/\.yaml$/, ''))
        .sort();
}

async function main(): Promise<void> {
    // Before either branch, so the only projection that can exist afterwards is the one
    // this invocation wrote. A stimulus build must leave none at all.
    clearProjection();

    const stackFlag = flagValue('--stack');
    if (stackFlag) {
        await buildFromStack(stackFlag, flagValue('--phase') ?? DEFAULT_PHASE);
        return;
    }
    buildFromStimulus(process.argv[2] || DEFAULT_STIMULUS);
}

/**
 * Load the stack machinery, and only then.
 *
 * These modules parse YAML and so import the `yaml` package, while this script
 * is run by `run.sh` on hosts that have no `node_modules` at all — the MSBench
 * `eval` job is checkout, setup-node, download-artifact, `run.sh --skip-build`,
 * and nothing installs anything. Importing them at the top of the file broke the
 * build immediately, which is the same trap `importScanner.ts` documents for
 * `stage-graders.ts`: **a script `run.sh` invokes on a clean machine cannot
 * acquire a third-party dependency without breaking that promise.**
 *
 * Deferring the import keeps the stimulus path — the one every current run uses
 * — dependency-free, and confines the requirement to `--stack`, where `run.sh`
 * installs the eval dependencies first. A failure here is reported as the
 * missing install it is, rather than as a stack trace about a package nobody
 * mentioned.
 */
async function loadStackMachinery() {
    try {
        const [inventory, table, wiring, stack] = await Promise.all([
            import('../src/containerInventory.ts'),
            import('../src/gateTable.ts'),
            import('../src/gateWiring.ts'),
            import('../src/stack.ts'),
        ]);
        return {
            loadContainerInventory: inventory.loadContainerInventory,
            loadGateTable: table.loadGateTable,
            deriveWiring: wiring.deriveWiring,
            teachesNothing: wiring.teachesNothing,
            loadStack: stack.loadStack,
        };
    } catch (error) {
        console.error(
            `--stack needs the eval dependencies, which are not installed here.\n`
            + `Run 'npm ci' in evals/ and try again. (${error instanceof Error ? error.message : String(error)})`,
        );
        process.exit(1);
    }
}

function flagValue(name: string): string | undefined {
    const index = process.argv.indexOf(name);
    if (index !== -1) {
        return process.argv[index + 1];
    }
    const inline = process.argv.find(argument => argument.startsWith(`${name}=`));
    return inline?.slice(name.length + 1);
}

/**
 * The `modelSelector:` block's `id`, wherever it sits in the merged config.
 *
 * Lazy up to the first `id:` *key*, which is `modelSelector`'s own — the other
 * `id`s in `base.yaml` belong to `installExtensions` list items and are written
 * `- id:`, so `\s+id:` does not match them. Kept in step with the regex in
 * `verify-run.ts`, which reads the same field back out of the staged file to
 * decide whether the model that answered was the model requested.
 */
const MODEL_SELECTOR_ID = /^(modelSelector:[\s\S]*?\n\s+id:[^\S\n]*)([^\s#]+)/m;

/**
 * Apply `--model <id>`, which retargets the run without touching `base.yaml`.
 *
 * ## Why this exists
 *
 * The suite this harness runs is explicit that "a Pass on one model is not a
 * Pass for the feature", and `config/stimuli/README-redteam.md` says to run the
 * red-team stimuli on every supported model. Until now there was no way to do
 * that: the model lives in `base.yaml`, which is shared by every stimulus and is
 * also the CES queueing key, so a sweep meant editing a checked-in file, running,
 * and remembering to put it back. All 38 runs in the local cache are
 * `claude-sonnet-4.5`, which is what that costs in practice.
 *
 * ## Why it fails loudly rather than falling back
 *
 * If the block cannot be found this exits non-zero instead of submitting with the
 * default. A `--model` that silently did nothing would produce a run labelled as
 * a sweep datapoint for a model that never answered — the precise mislabelling
 * `verify-run.ts` exits 65 to prevent, except arrived at before the run rather
 * than after, and therefore for free.
 *
 * The override is recorded as a trailing comment so the generated file explains
 * itself. `verify-run.ts` reads `[^"'\s#]+`, so the comment cannot be mistaken
 * for part of the id.
 */
function applyModelOverride(merged: string): string {
    const model = flagValue('--model');
    if (model === undefined) {
        return merged;
    }
    if (!model || model.startsWith('--')) {
        console.error('--model needs a model id, e.g. --model claude-opus-4.7');
        process.exit(1);
    }
    const match = MODEL_SELECTOR_ID.exec(merged);
    if (!match) {
        console.error(
            'Could not find a modelSelector.id to override in the generated config.\n'
            + '  --model must not silently do nothing: the run would be recorded as a\n'
            + '  datapoint for a model that never answered.',
        );
        process.exit(1);
    }
    const previous = match[2];
    if (previous === model) {
        return merged;
    }
    return merged.replace(MODEL_SELECTOR_ID, `$1${model} # --model override (base.yaml default: ${previous})`);
}

/**
 * Build the config from a stack, synthesising layer 3 instead of reading it.
 *
 * A stack is **not** a fourth concatenated layer. The merge below is textual and
 * guarded by "the three files must define disjoint top-level keys", while the
 * two things a stack controls — the prompt and the gate wiring — both live
 * inside `promptSteps`, which the stimulus layer owns. Concatenation cannot
 * merge into a list, so a fourth layer would have to break that guard, and the
 * guard is what stops a typo becoming a paid run that grades the wrong thing.
 *
 * So the stack is a fourth *input*: it produces the same third layer that a
 * hand-written stimulus would, and every hand-written stimulus keeps working
 * untouched.
 */
async function buildFromStack(stackId: string, phase: string): Promise<void> {
    const { loadContainerInventory, loadGateTable, deriveWiring, teachesNothing, loadStack } = await loadStackMachinery();

    const stackPath = join(STACKS, `${stackId}.yaml`);
    if (!existsSync(stackPath)) {
        console.error(`Unknown stack '${stackId}'. Available:\n${availableIn(STACKS).map(name => `  ${name}`).join('\n')}`);
        process.exit(1);
    }
    const phasePath = join(PHASES, `${phase}.yaml`);
    if (!existsSync(phasePath)) {
        console.error(`Unknown phase '${phase}'. Available:\n${availableIn(PHASES).map(name => `  ${name}`).join('\n')}`);
        process.exit(1);
    }

    const inventory = loadContainerInventory(join(CONFIG, 'container.yaml'));
    const table = loadGateTable(join(CONFIG, 'gates.yaml'), REPO_ROOT);
    const stack = loadStack(stackPath, { inventory, phasesDirectory: PHASES });

    if (!stack.phases.includes(phase)) {
        console.error(`Stack '${stackId}' does not declare phase '${phase}'. It declares: ${stack.phases.join(', ')}.`);
        process.exit(1);
    }

    const wiring = deriveWiring(stack, table, phase);
    if (wiring.wired.length === 0) {
        console.error(
            `Stack '${stackId}' wires no gates in phase '${phase}', so the run would assert nothing beyond the `
            + `liveness sentinel. Check the gate table's phases, or the stack's project facts.`,
        );
        process.exit(1);
    }

    const phaseText = readFileSync(phasePath, 'utf8');
    checkSeedMatchesStack(stack, phase);
    const merged = applyModelOverride([
        `# GENERATED by build-config.ts from config/base.yaml + config/phases/${phase}.yaml`,
        `# + config/stacks/${stackId}.yaml (gates derived via config/gates.yaml).`,
        `# Do not edit — edit those instead.`,
        `# Regenerate with: ./run.sh --stack ${stackId} --phase ${phase}`,
        '',
        readFileSync(join(CONFIG, 'base.yaml'), 'utf8').trimEnd(),
        '',
        stripSchemaDirective(phaseText).trimEnd(),
        '',
        renderStimulus(stack, wiring, phaseTurns(phaseText, phase)),
        '',
    ].join('\n'));

    writeFileSync(DEST, merged);
    assertParses(merged, `stack:${stackId}`, phase);
    writeProjection(stack);
    console.log(`Built assets/user-overrides.yaml for stack '${stackId}' (phase '${phase}')`);
    for (const entry of wiring.wired) {
        const args = entry.args.length > 0 ? ` ${entry.args.join(' ')}` : '';
        const gap = entry.knownGapReason ? `  [known gap: ${entry.knownGapReason}]` : '';
        console.log(`  wired: ${entry.gate.id}${args}${gap}`);
    }
    for (const entry of wiring.excluded) {
        console.log(`  not applicable: ${entry.gate.id} — ${entry.because}`);
    }

    // A warning, deliberately not an error. Someone may want the run as a
    // control, or for something outside this phase — but "this run is
    // pre-determined to teach us nothing" is computable before the money is
    // spent, so it gets said out loud rather than discovered in the report.
    if (teachesNothing(wiring)) {
        console.log('');
        console.log(`WARNING: every gate wired in phase '${phase}' is a declared known gap:`);
        for (const entry of wiring.wired) {
            console.log(`  ${entry.gate.id} — ${entry.knownGapReason}`);
        }
        console.log('  This run can produce no new information about the product. Submit it only');
        console.log('  deliberately — as a control, or to exercise something this phase does not gate.');
    }
}

/**
 * Render layer 3: the prompt, the liveness sentinel, the derived gates.
 *
 * The sentinel comes first and is not optional. Half of what a stimulus asserts
 * is negative, and a negative count over an empty table is trivially true — a
 * run that dies before the session database is populated would otherwise collect
 * full marks for having produced nothing.
 */
/**
 * A turn the phase needs around the stack's own prompt.
 *
 * A hand-written stimulus carries its own turns, so this only exists for the generated
 * ones — and it exists because a stack has a *prompt*, not a script, while a phase is
 * exactly the layer that knows how many turns its product flow takes.
 *
 * Both phases that need one needed it for opposite reasons, which is why this is a shape
 * rather than a special case:
 *
 *   - `plan` needs a turn **after**. The flow is describe -> requirements -> approve ->
 *     plan, so a single-turn run stops at the requirements gate with no plan written, and
 *     every plan-dependent gate fails for a reason that says nothing about the agent.
 *     Measured, not reasoned: run 2026082711703720 passed the requirements and
 *     no-scaffold gates and failed project-plan, webview-parseable and debug-gate,
 *     because there was no second turn to approve anything.
 *   - `local` needs a turn **before**, in the scaffold agent, so the debug agent has real
 *     generated output to scan rather than a frozen fixture.
 *
 * Declared as header directives rather than YAML keys because the phase file is
 * concatenated verbatim into the generated config: a real key would land in the
 * submitted document and fail schema validation, while a comment is inert there and
 * still readable. Exactly the mechanism `# phase:` and `# seed:` already use in stimuli.
 */
interface PhaseTurn {
    readonly text: string;
    /** Overrides the phase's own `chatMode` for this turn, for setup turns run by another agent. */
    readonly chatMode?: string;
}

interface PhaseTurns {
    readonly before?: PhaseTurn;
    readonly after?: PhaseTurn;
    /**
     * Replaces the stack prompt as the phase's own ask.
     *
     * A stack's `prompt` describes the application to build, which is exactly the right
     * thing to send in the plan phase and exactly the wrong thing anywhere else. The local
     * phase asks a different question — "now set up debugging for the project that already
     * exists" — and the app description has no place in it: the app was already described
     * in the plan the seed staged.
     *
     * Without this, a stack-driven local run sent "I'd like to create an app where you can
     * upload photos…" to `azure-debug-plan`. The agent was never asked to plan debugging,
     * never wrote `.azure/vscode-debug-plan.md`, and all four debug gates failed on its
     * absence — a red with nothing to say about the product (run 2026082875609243).
     */
    readonly instead?: PhaseTurn;
}

const TURN_BEFORE = /^#\s*turn-before:\s*(.+)$/im;
const TURN_BEFORE_MODE = /^#\s*turn-before-mode:\s*(\S+)\s*$/im;
const TURN_AFTER = /^#\s*turn-after:\s*(.+)$/im;
const TURN_INSTEAD = /^#\s*turn-instead:\s*(.+)$/im;

function phaseTurns(phaseText: string, phase: string): PhaseTurns {
    const before = TURN_BEFORE.exec(phaseText)?.[1].trim();
    const chatMode = TURN_BEFORE_MODE.exec(phaseText)?.[1].trim();
    const after = TURN_AFTER.exec(phaseText)?.[1].trim();
    const instead = TURN_INSTEAD.exec(phaseText)?.[1].trim();

    // A mode with no turn to apply it to is a directive that silently does nothing, which
    // is the failure mode this whole file family keeps rediscovering.
    if (chatMode && !before) {
        console.error(`config/phases/${phase}.yaml declares turn-before-mode but no turn-before.`);
        process.exit(1);
    }
    // `turn-after` grades a turn that follows the ask, so it needs an ask to follow. With
    // `turn-instead` also replacing the ask the two are answerable but the ordering is not
    // obvious to a reader, and a phase that wanted both has not existed yet.
    if (instead && after) {
        console.error(`config/phases/${phase}.yaml declares both turn-instead and turn-after; only one may replace the stack prompt.`);
        process.exit(1);
    }
    return {
        before: before ? { text: before, chatMode } : undefined,
        after: after ? { text: after } : undefined,
        instead: instead ? { text: instead } : undefined,
    };
}

/**
 * Refuse a stack whose declared shape disagrees with the plan the seed staged.
 *
 * A seed carries project *content*, not just turn shape, and the scaffold turn executes it
 * faithfully. So a stack that declares one thing while its seeded plan describes another
 * scaffolds one project and grades a different one — and every downstream verdict is about
 * neither.
 *
 * Measured, at full price: `react-express-file` (hosting=appService, datastore=none) was
 * pointed at the local phase, whose only seed is a React + Azure Functions + PostgreSQL
 * plan. The scaffold turn built a Functions project and all five runtime gates reported
 * `functionsHostUnavailable` on a stack whose entire premise is that it uses no Functions
 * (run 2026082867546686). Nothing was checking, so the contradiction cost a whole run to
 * discover — one of three runs that day spent on something a local check could have said
 * for free.
 *
 * Deliberately a keyword scan over the plan text rather than a parse. The plan is prose
 * written by an agent, its headings move, and this only needs to catch the case where the
 * two disagree *loudly*. A precise reader would fail closed on wording changes, which is
 * how a guard turns into an obstacle and gets deleted.
 */
function checkSeedMatchesStack(stack: Stack, phase: string): void {
    const planPath = join(ASSETS, 'workspace', '.azure', 'project-plan.md');
    if (!existsSync(planPath)) {
        return;
    }
    const plan = readFileSync(planPath, 'utf8').toLowerCase();
    const problems: string[] = [];

    const planWantsFunctions = /\bazure functions\b/.test(plan);
    if (planWantsFunctions && stack.project.hosting !== 'functions') {
        problems.push(`the seeded plan describes an Azure Functions app, but this stack declares hosting: ${stack.project.hosting}.`);
    }

    const planWantsDatastore = /\bpostgres(?:ql)?\b|\bcosmos\b|\bmongo(?:db)?\b/.test(plan);
    if (planWantsDatastore && stack.project.datastore === 'none') {
        problems.push('the seeded plan describes a database, but this stack declares datastore: none.');
    }

    if (problems.length === 0) {
        return;
    }
    console.error(`config/stacks/${stack.id}.yaml disagrees with the workspace seed for phase '${phase}':`);
    for (const problem of problems) {
        console.error(`  ${problem}`);
    }
    console.error('');
    console.error('The scaffold turn executes the seeded plan, so the run would build one project');
    console.error('and grade another. Point the phase at a stack the seed describes, or give this');
    console.error('stack a seed of its own — see harvest-seed.ts, which exists so a second');
    console.error('hand-maintained fixture does not have to.');
    process.exit(1);
}

/** One `promptSteps` entry, rendered with the block scalar the hand-written stimuli use. */
function renderStep(turn: PhaseTurn, assertions: string[]): string[] {
    const lines = turn.chatMode
        ? [`  - chatMode: ${turn.chatMode}`, '    text: |']
        : ['  - text: |'];
    lines.push(...turn.text.trimEnd().split('\n').map(line => `      ${line}`));
    lines.push('    assertions:');
    lines.push(...assertions);
    return lines;
}

/**
 * The sentinel, which every turn carries rather than only the first.
 *
 * One per turn is mandatory in a multi-turn stimulus: a run that dies after turn 0 leaves
 * every later negative assertion vacuously true, and a lone step-0 sentinel still passes.
 */
function sentinel(): string[] {
    return [
        '      # Liveness sentinel — must come first. Without it the negative assertions',
        '      # below pass trivially against an empty table.',
        `      - comment: ${SENTINEL_COMMENT}`,
        "        query: SELECT COUNT(*) > 0 FROM llm_responses",
        '',
    ];
}

function renderStimulus(stack: Stack, wiring: PhaseWiring, turns: PhaseTurns): string {
    const graded: string[] = [];
    for (const entry of wiring.wired) {
        const args = entry.args.length > 0 ? ` ${entry.args.join(' ')}` : '';
        if (entry.knownGapReason) {
            graded.push(`      # Declared known gap (${entry.knownGapReason}): expected to exit 3 with a`);
            graded.push('      # NOT_APPLICABLE marker. Red here is not evidence about the generated app.');
        }
        graded.push(`      - comment: ${entry.gate.summary}`);
        graded.push(`        exec: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON /agent/assets/graders/${entry.gate.grader}${args}`);
        graded.push('');
    }

    // Recorded, never asserted. `config/container.yaml` is mostly documentation
    // repeated between people rather than observation, and this line is what
    // turns the next run anybody submits — for any reason — into a measurement
    // of it, at no extra cost.
    graded.push('      # Recorded, not asserted: the container inventory config/container.yaml claims.');
    graded.push(`      - comment: ${FINGERPRINT_COMMENT}`);
    graded.push("        exec: 'uname -sm; echo \"cwd=$(pwd)\"; for b in node npm python3 pip3 func go dotnet docker azd java azurite psql postgres mongod redis-server; do printf \"%s=%s\\n\" \"$b\" \"$(command -v $b || echo MISSING)\"; done; python3 -m ensurepip --version 2>&1 | head -1'");
    graded.push('        assertZeroExitCode: false');

    const lines: string[] = [
        `# Layer 3, generated from config/stacks/${stack.id}.yaml. ${stack.name}.`,
        '',
        'promptSteps:',
    ];

    // The graders go on the LAST turn, which is what the hand-written stimuli do and the
    // only placement that can be right: an `exec:` grader reads the workspace as it stands
    // when the step runs, so scoring the plan phase before its approval turn grades a
    // document the agent has not been asked to write yet.
    if (turns.before) {
        lines.push(...renderStep(turns.before, sentinel()));
    }
    const promptTurn: PhaseTurn = turns.instead ?? { text: stack.prompt };
    if (turns.after) {
        lines.push(...renderStep(promptTurn, sentinel()));
        lines.push(...renderStep(turns.after, [...sentinel(), ...graded]));
    } else {
        lines.push(...renderStep(promptTurn, [...sentinel(), ...graded]));
    }

    return lines.join('\n');
}

/**
 * Remove any projection left by a previous build.
 *
 * `assets/` is shared mutable state reused across invocations, and this file is written
 * *outside* the tree `stage-graders.ts` wipes, so nothing else clears it. That makes a
 * stale projection outlive the build that produced it, and it is read by rung 0 of the
 * route discovery in `src/runtime/runtimeTarget.ts` — from
 * `evals/msbench/assets/stack.json` locally and `/agent/assets/stack.json` in the
 * container, which is exactly where `--agent-assets` uploads it.
 *
 * So a stack build followed by a stimulus build would ship the stack's `healthPath` and
 * `collectionRoute` into a run that never declared them, and the runtime gates would probe
 * routes the stimulus does not have. Same failure shape as an uncleared `assets/workspace`,
 * and cleared unconditionally for the same reason.
 *
 * Observed rather than imagined: building `--stack react-express-file` left a projection
 * naming `/api/projects`, and grader certification then failed two `runtime-crud` cases
 * against a fixture serving `/api/items` — `POST /api/projects returned 404`. It survived
 * `git stash` and a detached checkout of the base branch, because the file is gitignored,
 * which made it look like a pre-existing upstream failure.
 */
function clearProjection(): void {
    rmSync(PROJECTION, { force: true });
}

/**
 * Write the resolved stack where the container can read it.
 *
 * Only the fields with a named consumer are projected. A field emitted "in case
 * someone needs it" is a field nobody validates and everybody half-trusts:
 * `healthPath` and `collectionRoute` become rung 0 of the discovery chains in
 * `runtime/runtimeTarget.ts`, `start` supplies a command for stacks whose
 * ecosystem the chain cannot walk, and `api` lets `runtime-app-starts` tell a
 * background worker that never listens from a web app that failed to.
 *
 * Absent fields are **omitted rather than nulled**, so "declared" and "declared
 * as nothing" cannot be confused — a distinction the health verdict turns on.
 */
function writeProjection(stack: Stack): void {
    const projection: Record<string, unknown> = { id: stack.id, api: stack.project.api };
    if (stack.project.healthPath) {
        projection.healthPath = stack.project.healthPath;
    }
    if (stack.project.collectionRoute) {
        projection.collectionRoute = stack.project.collectionRoute;
    }
    if (stack.runtime.start) {
        projection.start = stack.runtime.start;
    }
    mkdirSync(ASSETS, { recursive: true });
    writeFileSync(PROJECTION, `${JSON.stringify(projection, undefined, 2)}\n`);
}

function availableIn(directory: string): string[] {
    return readdirSync(directory)
        .filter(name => name.endsWith('.yaml'))
        .map(name => name.replace(/\.yaml$/, ''))
        .sort();
}

function buildFromStimulus(stimulus: string): void {
    const stimulusPath = join(STIMULI, `${stimulus}.yaml`);

    if (!existsSync(stimulusPath)) {
        console.error(`Unknown stimulus '${stimulus}'. Available:\n${available().map(n => `  ${n}`).join('\n')}`);
        process.exit(1);
    }

    const stimulusText = readFileSync(stimulusPath, 'utf8');
    const phase = PHASE_DIRECTIVE.exec(stimulusText)?.[1] ?? DEFAULT_PHASE;
    const phasePath = join(PHASES, `${phase}.yaml`);
    if (!existsSync(phasePath)) {
        console.error(
            `stimuli/${stimulus}.yaml declares phase '${phase}', but config/phases/${phase}.yaml does not exist.\n` +
            `Available phases:\n${readdirSync(PHASES).filter(n => n.endsWith('.yaml')).map(n => `  ${n.replace(/\.yaml$/, '')}`).sort().join('\n')}`
        );
        process.exit(1);
    }

    const merged = applyModelOverride([
        `# GENERATED by build-config.ts from config/base.yaml + config/phases/${phase}.yaml`,
        `# + config/stimuli/${stimulus}.yaml. Do not edit — edit those instead.`,
        `# Regenerate with: ./run.sh --stimulus ${stimulus}`,
        '',
        readFileSync(join(CONFIG, 'base.yaml'), 'utf8').trimEnd(),
        '',
        stripSchemaDirective(readFileSync(phasePath, 'utf8')).trimEnd(),
        '',
        stimulusText.trimEnd(),
        '',
    ].join('\n'));

    writeFileSync(DEST, merged);
    assertParses(merged, stimulus, phase);
    assertNoFilesQueriesWithoutSnapshot(merged, stimulus, phase);
    assertNoFilesQueriesOnUntrackedPaths(merged, stimulus, phase, seedPaths(seedFor(stimulusText)));
    assertFilesAssertionsArePaired(merged, stimulus);
    console.log(`Built assets/user-overrides.yaml for stimulus '${stimulus}' (phase '${phase}')`);
}

/**
 * The phase files carry their own `yaml-language-server` directive so they get
 * schema help while being edited. It is dropped on the way in: repeated in the
 * middle of the generated file it is inert noise, and the copy from base.yaml
 * already sits on line 1 where the language server looks for it.
 */
function stripSchemaDirective(text: string): string {
    return text.replace(/^#\s*yaml-language-server:.*\n/m, '');
}

/**
 * A cheap structural check on the concatenation. Not a schema validation — the
 * yaml-language-server directive in base.yaml covers that in the editor, and the
 * eval harness validates properly on the far side. This only catches the failure
 * mode concatenation can actually introduce: a duplicated or malformed top-level
 * key that would otherwise surface as a confusing container-side error.
 *
 * Deliberately a hard error rather than a last-one-wins override. A silent
 * override would turn a typo in a stimulus into a run that starts, costs money
 * and grades the wrong thing; this way it costs nothing and says so.
 */
function assertParses(merged: string, stimulus: string, phase: string): void {
    const topLevelKeys = merged
        .split('\n')
        .filter(line => /^[A-Za-z]/.test(line))
        .map(line => line.split(':')[0]);
    const duplicates = topLevelKeys.filter((key, index) => topLevelKeys.indexOf(key) !== index);
    if (duplicates.length) {
        console.error(
            `base.yaml, phases/${phase}.yaml and stimuli/${stimulus}.yaml do not define disjoint ` +
            `top-level keys. Duplicated: ${[...new Set(duplicates)].join(', ')}`
        );
        process.exit(1);
    }
    if (!topLevelKeys.includes('promptSteps')) {
        console.error(`stimuli/${stimulus}.yaml does not define promptSteps`);
        process.exit(1);
    }
}

/**
 * The local half of a fail-fast the schema already performs remotely.
 *
 * `snapshotWorkspace: false` empties the `files` table, and `TestConfig.schema.json`
 * is explicit about what that means for assertions written against it:
 *
 *   "To avoid silent/confusing results, the run fails fast if snapshotting is
 *    disabled while any assertion queries the 'files' table."
 *
 * That is the right behaviour and it is not being second-guessed here — it is
 * being moved. Discovering the mistake remotely costs a submitted run: the queue
 * wait, the container pull, the VSIX install, and the several minutes before the
 * runner reaches assertion validation, all to be told about a typo. Discovering
 * it here costs a few milliseconds, and says the same thing.
 *
 * It matters most for exactly the stimuli that are hardest to get right by hand:
 * the scaffold and local-dev phases both disable snapshotting, so every artifact
 * assertion in them has to be an `exec:` grader rather than the
 * `SELECT ... FROM files WHERE path LIKE ...` one-liner that every pre-existing
 * stimulus in this folder uses and that is therefore the obvious thing to copy.
 *
 * Deliberately conservative about what counts as a `files` query: a bare `files`
 * word boundary after FROM/JOIN in an assertion `query:`. Comments are excluded,
 * because the phase files and this rule are *explained* in prose that necessarily
 * mentions the table by name.
 */
function assertNoFilesQueriesWithoutSnapshot(merged: string, stimulus: string, phase: string): void {
    if (!/^snapshotWorkspace:\s*false\s*$/m.test(merged)) {
        return;
    }

    const offenders = merged
        .split('\n')
        .map(line => line.trim())
        .filter(line => /^-?\s*query:/.test(line))
        .filter(line => /\b(?:from|join)\s+files\b/i.test(line));

    if (offenders.length) {
        console.error(
            `stimuli/${stimulus}.yaml runs under phase '${phase}', which sets snapshotWorkspace: false,\n` +
            `but ${offenders.length} assertion(s) query the 'files' table:\n` +
            offenders.map(line => `  ${line}`).join('\n') + '\n\n' +
            `TestConfig.schema.json: "To avoid silent/confusing results, the run fails fast if\n` +
            `snapshotting is disabled while any assertion queries the 'files' table."\n\n` +
            `The run would be rejected in-container after the queue wait and the container pull.\n` +
            `Route artifact checks through an 'exec:' grader instead — exec/command, tool-call and\n` +
            `LLM-response assertions all keep working with snapshotting disabled.`
        );
        process.exit(1);
    }
}

/**
 * Reject `files`-table assertions that cannot mean what they appear to mean.
 *
 * This is a *different* failure from the `snapshotWorkspace` guard above, and the
 * difference is the whole reason it needs its own check. That one catches "the
 * table is empty, so every query over it is vacuous". This catches "the table is
 * populated, but this particular query structurally cannot match" — and the
 * population is exactly what hides it, because a `COUNT(*) > 0` sanity check
 * passes happily while the assertion underneath means nothing.
 *
 * The root cause is an abstraction that lies at the point of use: **the `files`
 * table looks like a filesystem listing and is not one.** It contains what the
 * *agent* wrote through the tracked channel during a step. A file put there by an
 * extension, by the phase's `script:` preamble, by the seed recipe, or by the
 * container itself is absent from it however plainly it exists on disk.
 *
 * Only two of those four are decidable from `build-config.ts`'s inputs, which are
 * the stimulus YAML and the phase YAML and nothing else:
 *
 *   written by the phase `script:`   yes
 *   written by the `# seed:` recipe  yes
 *   written by an extension          NO
 *   created by the container         NO
 *
 * So this guard covers a real and recurring class, and it is important not to
 * read it as covering more. It would NOT have caught the `debug-probe-smoke`
 * run that prompted it: that assertion's path was written by a VS Code extension
 * during workspace setup, which appears in neither of this script's two inputs.
 * A guard that reads as covering more than it does is worse than no guard,
 * because it stops people looking.
 *
 * The undecidable half is handled by `assertFilesAssertionsArePaired` instead —
 * not by deciding it, which is impossible here, but by making it diagnosable in
 * seconds rather than by a forensic pass over a spent run.
 */
function assertNoFilesQueriesOnUntrackedPaths(
    merged: string,
    stimulus: string,
    phase: string,
    seededPaths: string[]
): void {
    const scripted = scriptWrittenPaths(merged);
    const untracked = [...seededPaths.map(p => ({ path: p, source: `the '# seed:' recipe` })),
                       ...scripted.map(p => ({ path: p, source: `the phase '${phase}' script:` }))];
    if (!untracked.length) {
        return;
    }

    const offenders: string[] = [];
    for (const { pattern, line } of filesAssertionPatterns(merged)) {
        for (const { path, source } of untracked) {
            if (pattern && (path.startsWith(pattern) || pattern.startsWith(path) || path.includes(pattern))) {
                offenders.push(`  ${line}\n      -> '${path}' is written by ${source}`);
            }
        }
    }

    if (offenders.length) {
        console.error(
            `stimuli/${stimulus}.yaml queries the 'files' table for a path that never passes\n` +
            `through the agent's tracked channel:\n\n` +
            offenders.join('\n') + '\n\n' +
            `The 'files' table is not a filesystem listing. It holds what the AGENT wrote during\n` +
            `a step, so a seeded or script-written file is absent from it however plainly it\n` +
            `exists on disk — the assertion asks a question the table cannot answer, and passes\n` +
            `or fails for reasons unrelated to the product. Use an 'exec:' grader instead.`
        );
        process.exit(1);
    }
}

/**
 * Every `files`-table assertion must ship with a non-asserting `test -f` for the
 * same path.
 *
 * This is the half that cannot be decided statically, made cheap instead. An
 * extension-written or container-created path is invisible to `build-config.ts`,
 * so no static check can tell that such an assertion is unanswerable. What a
 * static check *can* do is insist the discriminator travels with it.
 *
 * With the pair in place, a red `files` assertion arrives with its own cause
 * attached: **present on disk but absent from `files` is the wrong-channel
 * signature**, and it is distinguishable from a genuine product failure by
 * reading one row of the `exec` table rather than by spending a second run. The
 * `debug-probe-smoke` run that motivated this would have been a red assertion
 * with its explanation attached instead of a red run needing forensics.
 *
 * `assertZeroExitCode: false` means it records without generating a check, so it
 * costs nothing at runtime and cannot change an assertion count — the same shape
 * as the environment fingerprint every stimulus already carries.
 *
 * It is a hard error rather than a documented convention on purpose. This
 * directory's recurring lesson is that remembered rules decay and mechanical ones
 * do not, and the rule is decidable from the stimulus YAML alone, so there is no
 * excuse for leaving it to memory.
 */
function assertFilesAssertionsArePaired(merged: string, stimulus: string): void {
    const execCommands = merged
        .split('\n')
        .filter(line => /^\s*(-\s*)?exec:/.test(line));

    const unpaired: string[] = [];
    for (const { pattern, line } of filesAssertionPatterns(merged)) {
        if (!pattern) {
            continue;
        }
        if (!execCommands.some(command => command.includes(pattern))) {
            unpaired.push(`  ${line}\n      -> no triage exec mentioning '${pattern}'`);
        }
    }

    if (unpaired.length) {
        console.error(
            `stimuli/${stimulus}.yaml has ${unpaired.length} 'files'-table assertion(s) with no paired\n` +
            `triage exec:\n\n` +
            unpaired.join('\n') + '\n\n' +
            `The 'files' table holds what the AGENT wrote through the tracked channel, not what\n` +
            `is on disk, and whether a given path can ever appear there is not decidable from\n` +
            `this config. So each such assertion must carry its own discriminator:\n\n` +
            `      - comment: ${DISK_TRIAGE_COMMENT}\n` +
            `        exec: 'test -f <path>; echo "exit=$?"'\n` +
            `        assertZeroExitCode: false\n\n` +
            `Present on disk but absent from 'files' is the wrong-channel signature. With the\n` +
            `pair, that is one row of the exec table; without it, it is another run.`
        );
        process.exit(1);
    }
}

/** Workspace-relative paths the phase `script:` creates or copies into /workspace. */
function scriptWrittenPaths(merged: string): string[] {
    const paths: string[] = [];
    for (const raw of merged.split('\n')) {
        const line = raw.trim();
        const mkdir = /^mkdir\s+(?:-p\s+)?(\/workspace\/\S+)/.exec(line);
        if (mkdir) {
            paths.push(mkdir[1]);
        }
        // `cp -r <src> <dest>`; only the destination matters, and a bare
        // `/workspace/` destination is the seed copy, already covered by seedPaths.
        const cp = /^cp\s+.*\s(\/workspace\/\S+)\s*$/.exec(line);
        if (cp && cp[1] !== '/workspace/') {
            paths.push(cp[1]);
        }
    }
    return [...new Set(paths)].map(p => p.replace(/^\/workspace\//, '').replace(/\/$/, '')).filter(Boolean);
}

/** The `LIKE '…'` literal of every assertion querying the `files` table. */
function filesAssertionPatterns(merged: string): { pattern: string; line: string }[] {
    return merged
        .split('\n')
        .map(line => line.trim())
        .filter(line => /^-?\s*query:/.test(line) && /\bfrom\s+files\b/i.test(line))
        .map(line => ({
            pattern: (/like\s+'([^']+)'/i.exec(line)?.[1] ?? '').replace(/%/g, ''),
            line,
        }));
}

void main();
