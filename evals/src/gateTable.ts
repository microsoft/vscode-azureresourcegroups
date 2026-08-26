/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Load and validate `msbench/config/gates.yaml` — what each gate looks at.
 *
 * The companion to `stack.ts`: a stack says what a project has, this says what a
 * gate needs, and `gateWiring.ts` intersects them. This module only reads facts;
 * it decides nothing.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ConfigValidationError, reject, requireObject, requireString, rejectUnknownKeys } from './configValidation.ts';

/**
 * A condition on a stack's declared facts.
 *
 * Deliberately tiny — two forms, no operators, no nesting:
 *
 *   `project.frontend: [spa]`      the field's value must be one of these
 *   `project.healthPath: present`  the optional field must be set
 *
 * An expression language would let a gate encode policy that belongs in the
 * gate, and would be unreviewable by the person the schema is written for: the
 * one checking a stack file against a prompt.
 */
export type GatePredicate = Record<string, string[] | 'present'>;

export interface GateArgument {
    value: string;
    when: GatePredicate;
}

export interface Gate {
    id: string;
    grader: string;
    summary: string;
    phases: string[];
    requires: GatePredicate;
    args: GateArgument[];
}

export interface GateTable {
    schemaVersion: 1;
    phases: string[];
    gates: Gate[];
    sourcePath: string;
}

const ROOT_KEYS = ['schemaVersion', 'phases', 'gates'] as const;
const GATE_KEYS = ['id', 'grader', 'summary', 'phases', 'requires', 'args'] as const;
const ARGUMENT_KEYS = ['value', 'when'] as const;

/**
 * Fact paths a predicate may name.
 *
 * A closed list, because the failure it prevents is silent: `project.frontent`
 * would never match anything, so the gate would be quietly unwired everywhere —
 * a gate wired nowhere reads as a clean run, which is the `never-attempted`
 * signal `gate-health.ts` exists to catch.
 */
const KNOWN_FACTS = [
    'ecosystem',
    'project.frontend',
    'project.api',
    'project.datastore',
    'project.hosting',
    'project.healthPath',
    'project.collectionRoute',
] as const;

/** Facts that are optional on a stack, and so are the only ones `present` is meaningful for. */
const OPTIONAL_FACTS = ['project.healthPath', 'project.collectionRoute'];

export function loadGateTable(filePath: string, repoRoot: string): GateTable {
    let text: string;
    try {
        text = readFileSync(filePath, 'utf8');
    } catch {
        throw new ConfigValidationError('gateTableUnreadable', filePath, 'the gate table could not be read.');
    }
    return parseGateTable(text, filePath, repoRoot);
}

export function parseGateTable(text: string, filePath: string, repoRoot: string): GateTable {
    let parsed: unknown;
    try {
        parsed = parseYaml(text);
    } catch (error) {
        reject('gateTableUnparseable', filePath, `not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
    }

    const root = requireObject(parsed, 'gateTableNotObject', filePath, 'the gate table');
    rejectUnknownKeys(root, ROOT_KEYS, 'gateTableUnknownKey', filePath, 'the gate table');
    if (root.schemaVersion !== 1) {
        reject('gateTableSchemaVersion', filePath, 'schemaVersion must be 1.');
    }

    if (!Array.isArray(root.phases) || root.phases.length === 0 || root.phases.some(phase => typeof phase !== 'string')) {
        reject('gateTablePhases', filePath, 'phases must be a non-empty list of phase names.');
    }
    const phases = root.phases as string[];

    if (!Array.isArray(root.gates) || root.gates.length === 0) {
        reject('gateTableGates', filePath, 'gates must be a non-empty list.');
    }

    const gates = (root.gates as unknown[]).map((entry, index) => parseGate(entry, index, filePath, phases, repoRoot));

    const duplicates = gates.map(gate => gate.id).filter((id, index, all) => all.indexOf(id) !== index);
    if (duplicates.length > 0) {
        reject('gateTableDuplicateId', filePath, `gate id declared more than once: ${[...new Set(duplicates)].join(', ')}.`);
    }

    return { schemaVersion: 1, phases, gates, sourcePath: filePath };
}

function parseGate(entry: unknown, index: number, filePath: string, phases: string[], repoRoot: string): Gate {
    const node = requireObject(entry, 'gateNotObject', filePath, `gates[${index}]`);
    rejectUnknownKeys(node, GATE_KEYS, 'gateUnknownKey', filePath, `gates[${index}]`);

    const id = requireString(node.id, 'gateId', filePath, `gates[${index}].id`);
    if (!/^[a-z0-9][a-z0-9-]+$/.test(id)) {
        reject('gateId', filePath, `gates[${index}].id must be kebab-case. Found: ${id}.`);
    }

    const grader = requireString(node.grader, 'gateGrader', filePath, `gates[${index}].grader`);
    // The gate id is derived from the grader filename by `gateId()` in
    // graderHarness.ts, and that token is what joins run rows to certification
    // results. If the two drift, one real gate's history silently becomes two
    // partial ones — which has already been observed.
    const expectedId = grader.replace(/^.*\/validate-/, '').replace(/\.ts$/, '');
    if (expectedId !== id) {
        reject(
            'gateGraderIdMismatch',
            filePath,
            `gates[${index}].id is '${id}' but its grader is '${grader}', which reports gate='${expectedId}'. `
            + `They must match, or run history and certification results cannot be joined.`,
        );
    }
    if (!existsSync(join(repoRoot, grader))) {
        reject(
            'gateGraderMissing',
            filePath,
            `gates[${index}].grader '${grader}' does not exist. A gate pointing at a deleted grader would be wired `
            + `into a run and fail there instead of here.`,
        );
    }

    if (!Array.isArray(node.phases) || node.phases.length === 0 || node.phases.some(phase => typeof phase !== 'string')) {
        reject('gatePhases', filePath, `gates[${index}].phases must be a non-empty list.`);
    }
    for (const phase of node.phases as string[]) {
        if (!phases.includes(phase)) {
            reject('gatePhaseUnknown', filePath, `gates[${index}] names phase '${phase}', which is not in the declared phases: ${phases.join(', ')}.`);
        }
    }

    return {
        id,
        grader,
        summary: requireString(node.summary, 'gateSummary', filePath, `gates[${index}].summary`),
        phases: node.phases as string[],
        requires: parsePredicate(node.requires ?? {}, filePath, `gates[${index}].requires`),
        args: parseArguments(node.args, filePath, index),
    };
}

function parseArguments(value: unknown, filePath: string, gateIndex: number): GateArgument[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        reject('gateArgs', filePath, `gates[${gateIndex}].args must be a list.`);
    }
    return (value as unknown[]).map((entry, index) => {
        const node = requireObject(entry, 'gateArgNotObject', filePath, `gates[${gateIndex}].args[${index}]`);
        rejectUnknownKeys(node, ARGUMENT_KEYS, 'gateArgUnknownKey', filePath, `gates[${gateIndex}].args[${index}]`);
        const argValue = requireString(node.value, 'gateArgValue', filePath, `gates[${gateIndex}].args[${index}].value`);
        if (!argValue.startsWith('--')) {
            reject('gateArgValue', filePath, `gates[${gateIndex}].args[${index}].value must be a flag beginning with '--'. Found: ${argValue}.`);
        }
        return { value: argValue, when: parsePredicate(node.when, filePath, `gates[${gateIndex}].args[${index}].when`) };
    });
}

export function parsePredicate(value: unknown, filePath: string, what: string): GatePredicate {
    const node = requireObject(value, 'gatePredicateNotObject', filePath, what);
    const predicate: GatePredicate = {};

    for (const [fact, condition] of Object.entries(node)) {
        if (!(KNOWN_FACTS as readonly string[]).includes(fact)) {
            reject(
                'gatePredicateUnknownFact',
                filePath,
                `${what} names '${fact}', which is not a fact a stack declares. Known facts: ${KNOWN_FACTS.join(', ')}. `
                + `An unknown fact would never match, silently unwiring this gate everywhere — and a gate wired nowhere `
                + `looks exactly like a clean run.`,
            );
        }
        if (condition === 'present') {
            if (!OPTIONAL_FACTS.includes(fact)) {
                reject(
                    'gatePredicatePresentOnRequiredFact',
                    filePath,
                    `${what} uses 'present' on '${fact}', which every stack always sets, so the condition is always true `
                    + `and states nothing. 'present' is only meaningful for: ${OPTIONAL_FACTS.join(', ')}.`,
                );
            }
            predicate[fact] = 'present';
            continue;
        }
        if (!Array.isArray(condition) || condition.length === 0 || condition.some(entry => typeof entry !== 'string')) {
            reject('gatePredicateValue', filePath, `${what}.${fact} must be a non-empty list of values, or the literal 'present'.`);
        }
        predicate[fact] = condition as string[];
    }
    return predicate;
}
