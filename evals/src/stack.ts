/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The stack schema: `msbench/config/stacks/<id>.yaml`.
 *
 * ## What a stack is, in one sentence
 *
 * A stack is **a project type expressed as data**, so that adding Python or C#
 * to the suite is a file rather than a fork.
 *
 * Every stimulus today is React + Azure Functions, hard-coded, and adding a
 * different project type means copying a YAML file and hand-editing eight
 * assertions. That is the thing this replaces.
 *
 * ## The load-bearing idea: a stack declares facts, not gates
 *
 * The obvious design is `gates: [runtime-health, runtime-crud, ...]` per stack.
 * It is the wrong shape, for two reasons that only get worse with time:
 *
 * 1. **It rots, in the direction that looks safe.** Thirty gates times N stacks
 *    is a matrix maintained by hand, and adding gate 31 means editing every
 *    stack file. The failure is a gate quietly not being wired anywhere — which
 *    reads as a clean run, and is the `never-attempted` signal `gate-health.ts`
 *    exists to catch.
 * 2. **It records a conclusion without its premise.** "runtime-frontend does not
 *    apply here" cannot be reviewed by anyone who has not read that gate.
 *    `frontend: none` can be reviewed by anyone who has read the prompt.
 *
 * So a stack declares what the project *has* — `project:` — and applicability is
 * computed from those facts against a central gate table. That derivation lands
 * in the next PR; this file is the vocabulary it will read, and validating the
 * vocabulary first is what makes that PR small.
 *
 * ## Why this makes `outOfScope` an alarm rather than noise
 *
 * A grader that cannot answer emits `NOT_APPLICABLE ... class=outOfScope` and
 * exits 3. `outOfScope` means the gate should never have been wired to this
 * stack. Under fact-derived wiring, a gate is only ever attached when the stack
 * declared the thing it looks at — so:
 *
 *   **an `outOfScope` marker in a run is a bug report against this schema.**
 *   It means the derivation is wrong, or a stack lied about its project. It is
 *   never expected noise, and whoever sees the first one should treat it as a
 *   defect here rather than as something to be explained away.
 *
 * That claim is deliberately falsifiable. If `outOfScope` markers keep arriving
 * from correctly-written stacks, this design is wrong and should be replaced.
 *
 * ## What a stack may NOT decide
 *
 * A stack may only decide things no existing layer decides. `base.yaml` owns the
 * model, the timeouts and the VSIX; `phases/<p>.yaml` owns the chat mode and the
 * workspace seeding. Those are refused here rather than silently overridden —
 * `modelSelector.id` is half the CES queueing key, so a stack quietly changing
 * it would move runs into a different queue, which is undetectable from the
 * result and unrecoverable after the fact.
 *
 * @see msbench/config/container.yaml — what the container has, and so what a stack may need.
 * @see graders/graderHarness.ts — the exit-code and NOT_APPLICABLE contract this serves.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Ecosystem } from './artifacts/scaffoldTree.ts';
import { DATASTORE_NOT_APPLICABLE_CODES } from './artifacts/datastoreFidelity.ts';
import { RUNTIME_NOT_APPLICABLE_CLASS } from './runtime/runtimeTarget.ts';
import type { PortRemap } from './runtime/runtimeTarget.ts';
import { ConfigValidationError, reject, requireEnum, requireObject, requireString, rejectUnknownKeys } from './configValidation.ts';
import type { BinaryFact, ContainerInventory } from './containerInventory.ts';

/**
 * `Ecosystem` is imported rather than re-declared, so the stack vocabulary cannot
 * drift from the one the fidelity analysers already speak — and `'go'` is added
 * here, on purpose, to say something true: a Go project is *expressible* as a
 * stack, and is *not* understood by those analysers. That gap is the whole story
 * of a Go stack (see `knownGaps` below), and the type says it out loud.
 */
export type StackEcosystem = Ecosystem | 'go';
const STACK_ECOSYSTEMS: readonly StackEcosystem[] = ['node', 'python', 'dotnet', 'go'];

/** The binary each ecosystem cannot run without. Used for a coherence check. */
const ECOSYSTEM_BINARY: Record<StackEcosystem, string> = {
    node: 'node',
    python: 'python3',
    dotnet: 'dotnet',
    go: 'go',
};

export type FrontendKind = 'none' | 'spa';
export type ApiKind = 'none' | 'http';
export type DatastoreKind = 'none' | 'postgres' | 'cosmos' | 'blob' | 'queue';
export type HostingKind = 'appService' | 'functions' | 'containerApps';

const FRONTEND_KINDS: readonly FrontendKind[] = ['none', 'spa'];
const API_KINDS: readonly ApiKind[] = ['none', 'http'];
const DATASTORE_KINDS: readonly DatastoreKind[] = ['none', 'postgres', 'cosmos', 'blob', 'queue'];
const HOSTING_KINDS: readonly HostingKind[] = ['appService', 'functions', 'containerApps'];

/**
 * The facts gates are wired from.
 *
 * Every field answers "does this project have the thing some gate looks at?".
 * A field that no gate would ever read does not belong here — it belongs in the
 * prompt.
 */
export interface StackProject {
    frontend: FrontendKind;
    api: ApiKind;
    datastore: DatastoreKind;
    hosting: HostingKind;
    /** The liveness endpoint, when there is one. Absent means the health gate has nothing to ask. */
    healthPath?: string;
    /** A list/create route, when there is one. Absent means the CRUD gate has nothing to ask. */
    collectionRoute?: string;
}

/**
 * Rung 0 of the start-command discovery chain in `runtime/runtimeTarget.ts`.
 *
 * That module already reserves `'stackDeclaration'` in `StartSource`,
 * `PortSource` and `HealthPathSource` — this is the declaration those literals
 * were waiting for. Consuming it is a later PR; the shape is fixed here so the
 * two cannot be designed against different pictures of each other.
 */
export interface StackStart {
    command: string;
    args: string[];
    /** Workspace-relative directory to run in. */
    cwd: string;
    port?: {
        value: number;
        remap?: PortRemap;
    };
}

export interface StackRuntime {
    /** Everything that must be on PATH for this stack's gates to run. */
    binaries: string[];
    start?: StackStart;
}

/**
 * A gate that is wired, applies, and is expected to be red for a reason that is
 * not the product's fault.
 *
 * This does **not** suppress anything. `coverageGap` reds are correct to stay
 * red — they are a true statement that we are not testing something we claim to
 * test — and hiding them would be the inflated-green failure in a new costume.
 * What a declaration buys is *grouping*: gate-health can report "five gates red,
 * all `functionsHostUnavailable`, declared" instead of "five gates broken".
 *
 * Every entry costs money on every run and returns no information, so an empty
 * `knownGaps` is the goal and a growing one is a bill.
 */
export interface StackKnownGap {
    /** Gate ids, as produced by `gateId()` — the grader filename minus `validate-`. */
    gates: string[];
    /** A reason code from the closed vocabulary the graders already emit. */
    reason: string;
    /** The absent binary this gap is caused by, when that is the cause. */
    binary?: string;
    /** Where the work to close this is tracked, or one line on why it is not. */
    tracking: string;
}

export interface Stack {
    schemaVersion: 1;
    id: string;
    name: string;
    ecosystem: StackEcosystem;
    prompt: string;
    project: StackProject;
    runtime: StackRuntime;
    knownGaps: StackKnownGap[];
    phases: string[];
    sourcePath: string;
}

const ROOT_KEYS = ['schemaVersion', 'id', 'name', 'ecosystem', 'prompt', 'project', 'runtime', 'knownGaps', 'phases'] as const;
const PROJECT_KEYS = ['frontend', 'api', 'datastore', 'hosting', 'healthPath', 'collectionRoute'] as const;
const RUNTIME_KEYS = ['binaries', 'start'] as const;
const START_KEYS = ['command', 'args', 'cwd', 'port'] as const;
const PORT_KEYS = ['value', 'remap'] as const;
const KNOWN_GAP_KEYS = ['gates', 'reason', 'binary', 'tracking'] as const;

/**
 * Keys owned by `base.yaml` and `phases/<p>.yaml`, refused with a specific
 * message rather than a generic "unrecognised key".
 *
 * The generic message would be correct and would teach nothing. `modelSelector`
 * is not a typo when someone writes it — it is someone reasonably assuming a
 * stack can pick its model, and the reason they cannot is worth one sentence at
 * the moment they try.
 */
const FOREIGN_KEYS: Record<string, string> = {
    modelSelector: 'base.yaml owns the model, and modelSelector.id is half the CES queueing key — a stack changing it '
        + 'would silently move runs into a different queue, which cannot be seen in the result or undone afterwards.',
    timeouts: 'base.yaml owns the timeouts; they are a per-run budget derived from the job cap, not a per-stack knob.',
    installExtensions: 'base.yaml owns the VSIX under test. A stack changing it would grade a different build.',
    dangerouslyAutoApproveAllToolCalls: 'base.yaml owns it; without it the webview tools block on a confirmation nothing can answer.',
    chatMode: 'phases/<phase>.yaml owns the agent under test. If a stack needs a different agent, it needs a different phase.',
    script: 'phases/<phase>.yaml owns workspace seeding. Per-stack seed fixtures hang off the phase, not off this file.',
    snapshotWorkspace: 'phases/<phase>.yaml owns it, because whether snapshotting is affordable is a property of the phase.',
    promptSteps: 'a stack supplies `prompt:`; build-config assembles promptSteps from it together with the derived assertions.',
};

/**
 * Machinery names that must not appear in a prompt.
 *
 * We will eventually need a **baseline arm** — the same project built by plain
 * Copilot with no Rails documents or tools — to measure what Rails is actually
 * worth. That arm crosses every stack, and it is only cheap if a stack's prompt
 * describes *the app to build* rather than *the app to build, using the Rails
 * flow*. A prompt naming `requirements.json` is unusable by the baseline arm and
 * would have to be rewritten, per stack, later.
 *
 * Note what is deliberately NOT here: the bare word "rails". A Ruby on Rails
 * stack is a perfectly plausible future project type, and a rule that made it
 * unaddable would be a worse bug than the one it prevents. Only the phrase and
 * the artifact names are matched.
 */
const RAILS_MACHINERY = [
    'copilot on rails',
    'on rails',
    'requirements.json',
    'project-plan.md',
    'deployment-plan.md',
    'vscode-debug-plan.md',
    'azure-project-plan',
    'open_requirements_view',
];

/** The union of every NOT_APPLICABLE reason code the graders can emit today. */
export function knownReasonCodes(): Set<string> {
    // Composed from the gate families rather than re-typed, so a family adding a
    // code does not need this file edited — and a family *removing* one turns a
    // stale stack declaration into a build error instead of a lie.
    //
    // One family is missing on purpose: `FIDELITY_NOT_APPLICABLE` is declared
    // inside `graders/validate-service-fidelity.ts`, and importing a grader
    // *executes* it (every grader calls runGrader* at module top level). Its only
    // code today is `ecosystemNotSupported`, which the runtime table already
    // carries, so nothing is lost — but that is luck, not design. See the note on
    // grader importability in the PR description.
    return new Set([
        ...Object.keys(RUNTIME_NOT_APPLICABLE_CLASS),
        ...Object.keys(DATASTORE_NOT_APPLICABLE_CODES),
    ]);
}

export interface StackLoadOptions {
    inventory: ContainerInventory;
    /** Directory holding `<phase>.yaml`, so a stack cannot name a phase that does not exist. */
    phasesDirectory: string;
}

export function loadStack(filePath: string, options: StackLoadOptions): Stack {
    let text: string;
    try {
        text = readFileSync(filePath, 'utf8');
    } catch {
        throw new ConfigValidationError('stackUnreadable', filePath, 'the stack file could not be read.');
    }
    return parseStack(text, filePath, options);
}

export function parseStack(text: string, filePath: string, options: StackLoadOptions): Stack {
    let parsed: unknown;
    try {
        parsed = parseYaml(text);
    } catch (error) {
        reject('stackUnparseable', filePath, `not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
    }

    const root = requireObject(parsed, 'stackNotObject', filePath, 'a stack');

    // Foreign keys are checked before unknown keys, so the specific explanation
    // wins over the generic one.
    for (const [key, why] of Object.entries(FOREIGN_KEYS)) {
        if (key in root) {
            reject('stackForeignKey', filePath, `a stack may not set '${key}'. ${why}`);
        }
    }
    rejectUnknownKeys(root, ROOT_KEYS, 'stackUnknownKey', filePath, 'a stack');

    if (root.schemaVersion !== 1) {
        reject('stackSchemaVersion', filePath, 'schemaVersion must be 1.');
    }

    const id = requireString(root.id, 'stackId', filePath, 'id');
    if (!/^[a-z0-9][a-z0-9-]+$/.test(id)) {
        reject('stackId', filePath, `id must be kebab-case. Found: ${id}.`);
    }
    // The filename is the identity everything else joins on — the CLI flag, the
    // generated config header, and eventually the run record. An id that differs
    // from its filename means two names for one thing, and every report has to
    // pick one.
    const expected = basename(filePath).replace(/\.yaml$/, '');
    if (id !== expected) {
        reject('stackIdFilenameMismatch', filePath, `id '${id}' must match the filename '${expected}.yaml'.`);
    }

    const name = requireString(root.name, 'stackName', filePath, 'name');
    const ecosystem = requireEnum(root.ecosystem, STACK_ECOSYSTEMS, 'stackEcosystem', filePath, 'ecosystem');
    const prompt = parsePrompt(root.prompt, filePath);
    const project = parseProject(root.project, filePath);
    const runtime = parseRuntime(root.runtime, filePath);
    const knownGaps = parseKnownGaps(root.knownGaps, filePath);
    const phases = parsePhases(root.phases, filePath, options.phasesDirectory);

    checkEcosystemBinary(ecosystem, runtime, filePath);
    checkHostingBinary(project, runtime, filePath);
    checkBinariesAgainstContainer(runtime, knownGaps, options.inventory, filePath);
    checkKnownGapsAreLive(runtime, knownGaps, options.inventory, filePath);

    return { schemaVersion: 1, id, name, ecosystem, prompt, project, runtime, knownGaps, phases, sourcePath: filePath };
}

function parsePrompt(value: unknown, filePath: string): string {
    const prompt = requireString(value, 'stackPrompt', filePath, 'prompt');
    // A one-word prompt is not a project description, and the failure it causes
    // is a whole run of the agent guessing.
    if (prompt.trim().length < 40) {
        reject('stackPrompt', filePath, 'prompt must actually describe a project (at least 40 characters).');
    }
    const lowered = prompt.toLowerCase();
    const found = RAILS_MACHINERY.filter(token => lowered.includes(token));
    if (found.length > 0) {
        reject(
            'stackPromptNamesRails',
            filePath,
            `prompt names Rails machinery (${found.join(', ')}). A prompt must describe the app to build and nothing `
            + `about how it will be built, so the same text can drive the baseline arm — plain Copilot, no Rails `
            + `documents or tools — without being rewritten per stack.`,
        );
    }
    return prompt;
}

function parseProject(value: unknown, filePath: string): StackProject {
    const node = requireObject(value, 'stackProjectNotObject', filePath, 'project');
    rejectUnknownKeys(node, PROJECT_KEYS, 'stackProjectUnknownKey', filePath, 'project');

    const frontend = requireEnum(node.frontend, FRONTEND_KINDS, 'stackProjectFrontend', filePath, 'project.frontend');
    const api = requireEnum(node.api, API_KINDS, 'stackProjectApi', filePath, 'project.api');
    const datastore = requireEnum(node.datastore, DATASTORE_KINDS, 'stackProjectDatastore', filePath, 'project.datastore');
    const hosting = requireEnum(node.hosting, HOSTING_KINDS, 'stackProjectHosting', filePath, 'project.hosting');

    const healthPath = parseOptionalRoute(node.healthPath, 'project.healthPath', filePath);
    const collectionRoute = parseOptionalRoute(node.collectionRoute, 'project.collectionRoute', filePath);

    // The `validateDataStoreAlignment` pattern from scenario.ts: two fields that
    // cannot both be true. A stack claiming no API but naming an HTTP route has
    // one of the two wrong, and either way the derivation would wire the wrong
    // gates — silently, since both fields are individually valid.
    if (api === 'none' && healthPath) {
        reject('stackHealthPathWithoutApi', filePath, 'project.healthPath is set but project.api is none — an app with no API has no health endpoint.');
    }
    if (api === 'none' && collectionRoute) {
        reject('stackRouteWithoutApi', filePath, 'project.collectionRoute is set but project.api is none — an app with no API has no routes.');
    }

    return { frontend, api, datastore, hosting, healthPath, collectionRoute };
}

function parseOptionalRoute(value: unknown, what: string, filePath: string): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    const route = requireString(value, 'stackRouteShape', filePath, what);
    if (!route.startsWith('/')) {
        reject('stackRouteShape', filePath, `${what} must be a path beginning with '/'. Found: ${route}.`);
    }
    return route;
}

function parseRuntime(value: unknown, filePath: string): StackRuntime {
    const node = requireObject(value, 'stackRuntimeNotObject', filePath, 'runtime');
    rejectUnknownKeys(node, RUNTIME_KEYS, 'stackRuntimeUnknownKey', filePath, 'runtime');

    if (!Array.isArray(node.binaries) || node.binaries.length === 0
        || node.binaries.some(entry => typeof entry !== 'string' || entry.length === 0)) {
        reject('stackRuntimeBinaries', filePath, 'runtime.binaries must be a non-empty list of binary names.');
    }
    const binaries = node.binaries as string[];
    const duplicates = binaries.filter((entry, index) => binaries.indexOf(entry) !== index);
    if (duplicates.length > 0) {
        reject('stackRuntimeBinaries', filePath, `runtime.binaries lists ${[...new Set(duplicates)].join(', ')} more than once.`);
    }

    return { binaries, start: node.start === undefined ? undefined : parseStart(node.start, filePath) };
}

function parseStart(value: unknown, filePath: string): StackStart {
    const node = requireObject(value, 'stackStartNotObject', filePath, 'runtime.start');
    rejectUnknownKeys(node, START_KEYS, 'stackStartUnknownKey', filePath, 'runtime.start');

    const command = requireString(node.command, 'stackStartCommand', filePath, 'runtime.start.command');
    if (node.args !== undefined && (!Array.isArray(node.args) || node.args.some(entry => typeof entry !== 'string'))) {
        reject('stackStartArgs', filePath, 'runtime.start.args must be a list of strings.');
    }
    const cwd = requireString(node.cwd, 'stackStartCwd', filePath, 'runtime.start.cwd');
    if (cwd.startsWith('/') || cwd.includes('..')) {
        reject('stackStartCwd', filePath, `runtime.start.cwd must be workspace-relative and must not escape it. Found: ${cwd}.`);
    }

    return {
        command,
        args: (node.args as string[] | undefined) ?? [],
        cwd,
        port: node.port === undefined ? undefined : parsePort(node.port, filePath),
    };
}

function parsePort(value: unknown, filePath: string): { value: number; remap?: PortRemap } {
    const node = requireObject(value, 'stackPortNotObject', filePath, 'runtime.start.port');
    rejectUnknownKeys(node, PORT_KEYS, 'stackPortUnknownKey', filePath, 'runtime.start.port');

    const port = node.value;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
        reject('stackPortValue', filePath, `runtime.start.port.value must be an integer between 1 and 65535. Found: ${JSON.stringify(port)}.`);
    }
    if (node.remap === undefined) {
        return { value: port };
    }

    // Mirrors `PortRemap` in runtimeTarget.ts. The runtime gates move the app to
    // a free port to avoid colliding with whatever else is on the machine, and a
    // remap that cannot be applied means the gate cannot run at all.
    const remapNode = requireObject(node.remap, 'stackPortRemap', filePath, 'runtime.start.port.remap');
    const kind = requireEnum(remapNode.kind, ['env', 'arg'] as const, 'stackPortRemap', filePath, 'runtime.start.port.remap.kind');
    if (kind === 'env') {
        return { value: port, remap: { kind: 'env', key: requireString(remapNode.key, 'stackPortRemap', filePath, 'runtime.start.port.remap.key') } };
    }
    const index = remapNode.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
        reject('stackPortRemap', filePath, 'runtime.start.port.remap.index must be a non-negative integer.');
    }
    return { value: port, remap: { kind: 'arg', index } };
}

function parseKnownGaps(value: unknown, filePath: string): StackKnownGap[] {
    if (value === undefined) {
        reject('stackKnownGapsMissing', filePath, "knownGaps must be present. Write `knownGaps: []` to say there are none — an empty list is a claim, and an omitted one is an oversight.");
    }
    if (!Array.isArray(value)) {
        reject('stackKnownGapsMissing', filePath, 'knownGaps must be a list.');
    }

    const reasons = knownReasonCodes();
    return (value as unknown[]).map((entry, index) => {
        const node = requireObject(entry, 'stackKnownGapNotObject', filePath, `knownGaps[${index}]`);
        rejectUnknownKeys(node, KNOWN_GAP_KEYS, 'stackKnownGapUnknownKey', filePath, `knownGaps[${index}]`);

        if (!Array.isArray(node.gates) || node.gates.length === 0
            || node.gates.some(gate => typeof gate !== 'string' || !/^[a-z0-9][a-z0-9-]+$/.test(gate))) {
            reject('stackKnownGapGates', filePath, `knownGaps[${index}].gates must be a non-empty list of kebab-case gate ids.`);
        }
        const reason = requireString(node.reason, 'stackKnownGapReason', filePath, `knownGaps[${index}].reason`);
        if (!reasons.has(reason)) {
            reject(
                'stackKnownGapReason',
                filePath,
                `knownGaps[${index}].reason '${reason}' is not a reason code any grader emits. Known codes: `
                + `${[...reasons].sort().join(', ')}. An invented code cannot be grouped by gate-health, so the red it `
                + `describes would arrive unexplained — which is the situation the declaration exists to prevent.`,
            );
        }
        // Prose, not a link, is allowed — but *something* is required. An
        // undeclared owner is how a gap becomes permanent: nobody is wrong to
        // ignore it, so everybody does.
        const tracking = requireString(node.tracking, 'stackKnownGapTracking', filePath, `knownGaps[${index}].tracking`);

        return {
            gates: node.gates as string[],
            reason,
            binary: typeof node.binary === 'string' ? node.binary : undefined,
            tracking,
        };
    });
}

function parsePhases(value: unknown, filePath: string, phasesDirectory: string): string[] {
    if (!Array.isArray(value) || value.length === 0 || value.some(entry => typeof entry !== 'string')) {
        reject('stackPhases', filePath, 'phases must be a non-empty list of phase names.');
    }
    const phases = value as string[];
    for (const phase of phases) {
        if (!existsSync(join(phasesDirectory, `${phase}.yaml`))) {
            reject('stackPhaseUnknown', filePath, `phases names '${phase}', but config/phases/${phase}.yaml does not exist.`);
        }
    }
    return phases;
}

/** A stack must require the interpreter or toolchain its ecosystem cannot run without. */
function checkEcosystemBinary(ecosystem: StackEcosystem, runtime: StackRuntime, filePath: string): void {
    const required = ECOSYSTEM_BINARY[ecosystem];
    if (!runtime.binaries.includes(required)) {
        reject(
            'stackEcosystemBinaryMissing',
            filePath,
            `ecosystem is '${ecosystem}', so runtime.binaries must include '${required}'. Leaving it out would hide the `
            + `stack's most basic requirement from the container check, which is the one check meant to run before money `
            + `is spent.`,
        );
    }
}

/**
 * A Functions stack must admit it needs `func`.
 *
 * This is the rule written directly from the injury. Every stimulus we run is
 * Azure Functions, the container has no `func`, and all five runtime gates have
 * therefore been red on every run — a fact nobody had written down anywhere a
 * tool could read. Declaring `hosting: functions` without listing the binary
 * would reproduce exactly that silence.
 */
function checkHostingBinary(project: StackProject, runtime: StackRuntime, filePath: string): void {
    if (project.hosting === 'functions' && !runtime.binaries.includes('func')) {
        reject(
            'stackFunctionsRequiresFunc',
            filePath,
            "project.hosting is 'functions', so runtime.binaries must include 'func' — the Functions host is how such an "
            + 'app starts at all. Listing it is what makes the container check notice it is missing.',
        );
    }
}

function checkBinariesAgainstContainer(
    runtime: StackRuntime,
    knownGaps: StackKnownGap[],
    inventory: ContainerInventory,
    filePath: string,
): void {
    const declaredBinaries = new Set(knownGaps.map(gap => gap.binary).filter((name): name is string => Boolean(name)));

    for (const binary of runtime.binaries) {
        const fact: BinaryFact | undefined = inventory.binaries.get(binary);
        if (!fact) {
            reject(
                'stackBinaryUnknown',
                filePath,
                `runtime.binaries names '${binary}', which ${basename(inventory.sourcePath)} says nothing about. Add a row `
                + `there first: an unlisted binary is an unanswered question, and the point of the check is that the `
                + `question gets answered before a run rather than during one.`,
            );
        }
        if (fact.status === 'unavailable') {
            reject(
                'stackBinaryUnavailable',
                filePath,
                `runtime.binaries requires '${binary}', which is unavailable in the eval container: ${fact.note}. `
                + `This stack cannot run there, and no declaration makes it able to — so it is refused rather than `
                + `submitted.`,
            );
        }
        if (fact.status === 'absent' && !declaredBinaries.has(binary)) {
            reject(
                'stackBinaryAbsentUndeclared',
                filePath,
                `runtime.binaries requires '${binary}', which is absent from the eval container, and no knownGaps entry `
                + `declares it (add one with binary: ${binary}). Install command: ${fact.install}. Without the `
                + `declaration the resulting red arrives with no explanation attached, which is how five missing-binary `
                + `failures get read as five broken gates.`,
            );
        }
    }
}

/**
 * A declaration that no longer describes anything is worse than no declaration.
 *
 * The failure being prevented is specific and slow: a binary gets installed in
 * the preamble, the gap closes, and the `knownGaps` entry stays — so the gate's
 * reds keep getting explained away by a reason that stopped being true. Both
 * checks here catch that the moment the fact underneath changes.
 */
function checkKnownGapsAreLive(
    runtime: StackRuntime,
    knownGaps: StackKnownGap[],
    inventory: ContainerInventory,
    filePath: string,
): void {
    for (const [index, gap] of knownGaps.entries()) {
        if (!gap.binary) {
            continue;
        }
        if (!runtime.binaries.includes(gap.binary)) {
            reject(
                'stackKnownGapBinaryNotRequired',
                filePath,
                `knownGaps[${index}] declares a gap for '${gap.binary}', which this stack does not require. `
                + `Nothing here would ever be red for that reason, so the declaration only misleads.`,
            );
        }
        const fact = inventory.binaries.get(gap.binary);
        if (fact?.status === 'present') {
            reject(
                'stackKnownGapBinaryPresent',
                filePath,
                `knownGaps[${index}] declares a gap for '${gap.binary}', but the container has it. Delete the entry — a `
                + `stale gap keeps explaining reds with a reason that is no longer true, which suppresses a real failure `
                + `for as long as nobody rereads it.`,
            );
        }
    }
}
