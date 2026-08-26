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

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

    const merged = [
        `# GENERATED by build-config.ts from config/base.yaml + config/phases/${phase}.yaml`,
        `# + config/stacks/${stackId}.yaml (gates derived via config/gates.yaml).`,
        `# Do not edit — edit those instead.`,
        `# Regenerate with: ./run.sh --stack ${stackId} --phase ${phase}`,
        '',
        readFileSync(join(CONFIG, 'base.yaml'), 'utf8').trimEnd(),
        '',
        stripSchemaDirective(readFileSync(phasePath, 'utf8')).trimEnd(),
        '',
        renderStimulus(stack, wiring),
        '',
    ].join('\n');

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
function renderStimulus(stack: Stack, wiring: PhaseWiring): string {
    const lines: string[] = [
        `# Layer 3, generated from config/stacks/${stack.id}.yaml. ${stack.name}.`,
        '',
        'promptSteps:',
        '  - text: |',
        ...stack.prompt.trimEnd().split('\n').map(line => `      ${line}`),
        '    assertions:',
        '      # Liveness sentinel — must come first. Without it the negative assertions',
        '      # below pass trivially against an empty table.',
        '      - comment: Sentinel; session data must exist or the negative checks below are vacuous',
        "        query: SELECT COUNT(*) > 0 FROM llm_responses",
        '',
    ];

    for (const entry of wiring.wired) {
        const args = entry.args.length > 0 ? ` ${entry.args.join(' ')}` : '';
        if (entry.knownGapReason) {
            lines.push(`      # Declared known gap (${entry.knownGapReason}): expected to exit 3 with a`);
            lines.push('      # NOT_APPLICABLE marker. Red here is not evidence about the generated app.');
        }
        lines.push(`      - comment: ${entry.gate.summary}`);
        lines.push(`        exec: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON /agent/assets/graders/${entry.gate.grader}${args}`);
        lines.push('');
    }

    // Recorded, never asserted. `config/container.yaml` is mostly documentation
    // repeated between people rather than observation, and this line is what
    // turns the next run anybody submits — for any reason — into a measurement
    // of it, at no extra cost.
    lines.push('      # Recorded, not asserted: the container inventory config/container.yaml claims.');
    lines.push('      - comment: Environment fingerprint for triage');
    lines.push("        exec: 'uname -sm; echo \"cwd=$(pwd)\"; for b in node npm python3 pip3 func go dotnet docker azd java; do printf \"%s=%s\\n\" \"$b\" \"$(command -v $b || echo MISSING)\"; done; python3 -m ensurepip --version 2>&1 | head -1'");
    lines.push('        assertZeroExitCode: false');

    return lines.join('\n');
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

    const merged = [
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
    ].join('\n');

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
            `      - comment: Triage; is the file on disk at all?\n` +
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
