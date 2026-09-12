/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Load and validate `msbench/config/container.yaml` — what the eval container has.
 *
 * The point of turning this into data is that a stack declaring `binaries: [go]`
 * can be refused *before* a run is submitted. The knowledge already existed; it
 * lived in prose in a README and in people's heads, where it could not stop
 * anything from happening.
 *
 * This module reads facts and makes no policy decisions. Whether an `absent`
 * binary is acceptable is a question about a *stack* and is answered in
 * `stack.ts`; whether the run is worth submitting is a question for a human.
 */

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { ConfigValidationError, reject, requireEnum, requireObject, requireString, rejectUnknownKeys } from './configValidation.ts';

/**
 * `absent` and `unavailable` are both "not on PATH", and the difference between
 * them is the only thing a stack author needs from this file:
 *
 *   absent      — installable in the run preamble. Requiring it is allowed, at
 *                 the price of declaring the gap it causes.
 *   unavailable — no practical path. Requiring it is refused outright.
 */
export type BinaryStatus = 'present' | 'absent' | 'unavailable';
const BINARY_STATUSES: readonly BinaryStatus[] = ['present', 'absent', 'unavailable'];

/**
 * Whether a row was observed in the container or copied from documentation.
 *
 * Carried per row rather than per file because the file is currently a mixture,
 * and averaging that into a single sentence at the top is how "mostly verified"
 * becomes "verified". A consumer that wants to report the difference can.
 */
export type Evidence = 'measured' | 'asserted';
const EVIDENCE_VALUES: readonly Evidence[] = ['measured', 'asserted'];

export interface BinaryFact {
    name: string;
    status: BinaryStatus;
    version?: string;
    /** For `absent`: the preamble command that would supply it, or `unverified`. */
    install?: string;
    /** For `unavailable`: why there is no path. */
    note?: string;
    evidence: Evidence;
}

export interface ContainerInventory {
    schemaVersion: 1;
    verifiedOn: string;
    binaries: Map<string, BinaryFact>;
    /** Absolute path of the file these facts came from, for error messages. */
    sourcePath: string;
}

const ROOT_KEYS = ['schemaVersion', 'verifiedOn', 'binaries'] as const;
const BINARY_KEYS = ['status', 'version', 'install', 'note', 'evidence'] as const;

export function loadContainerInventory(filePath: string): ContainerInventory {
    let text: string;
    try {
        text = readFileSync(filePath, 'utf8');
    } catch {
        throw new ConfigValidationError('containerInventoryMissing', filePath, 'the container inventory could not be read.');
    }
    return parseContainerInventory(text, filePath);
}

export function parseContainerInventory(text: string, filePath: string): ContainerInventory {
    let parsed: unknown;
    try {
        parsed = parseYaml(text);
    } catch (error) {
        reject('containerInventoryUnparseable', filePath, `not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
    }

    const root = requireObject(parsed, 'containerInventoryNotObject', filePath, 'the container inventory');
    rejectUnknownKeys(root, ROOT_KEYS, 'containerInventoryUnknownKey', filePath, 'the container inventory');

    if (root.schemaVersion !== 1) {
        reject('containerInventorySchemaVersion', filePath, 'schemaVersion must be 1.');
    }
    const verifiedOn = requireString(root.verifiedOn, 'containerInventoryVerifiedOn', filePath, 'verifiedOn');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(verifiedOn)) {
        reject('containerInventoryVerifiedOn', filePath, `verifiedOn must be an ISO date (YYYY-MM-DD). Found: ${verifiedOn}.`);
    }

    const binariesNode = requireObject(root.binaries, 'containerInventoryBinaries', filePath, 'binaries');
    const binaries = new Map<string, BinaryFact>();
    for (const [name, value] of Object.entries(binariesNode)) {
        binaries.set(name, parseBinary(name, value, filePath));
    }
    if (binaries.size === 0) {
        reject('containerInventoryBinaries', filePath, 'binaries must describe at least one binary.');
    }

    return { schemaVersion: 1, verifiedOn, binaries, sourcePath: filePath };
}

function parseBinary(name: string, value: unknown, filePath: string): BinaryFact {
    const entry = requireObject(value, 'containerBinaryNotObject', filePath, `binaries.${name}`);
    rejectUnknownKeys(entry, BINARY_KEYS, 'containerBinaryUnknownKey', filePath, `binaries.${name}`);

    const status = requireEnum(entry.status, BINARY_STATUSES, 'containerBinaryStatus', filePath, `binaries.${name}.status`);
    const evidence = requireEnum(entry.evidence, EVIDENCE_VALUES, 'containerBinaryEvidence', filePath, `binaries.${name}.evidence`);

    // Each status carries the field that makes it actionable, and is rejected
    // without it. An `absent` row with no `install:` is the shape that sends
    // someone to go and find out what everybody else already knew, which is the
    // cost this file was written to remove.
    if (status === 'absent' && typeof entry.install !== 'string') {
        reject(
            'containerBinaryInstallMissing',
            filePath,
            `binaries.${name} is absent and must carry install: — either the preamble command that supplies it, `
            + `or the literal 'unverified' to say we have not established one.`,
        );
    }
    if (status === 'unavailable' && typeof entry.note !== 'string') {
        reject(
            'containerBinaryNoteMissing',
            filePath,
            `binaries.${name} is unavailable and must carry note: explaining why there is no path to having it. `
            + `Refusing a stack outright needs a reason the reader can check.`,
        );
    }
    if (status === 'present' && entry.install !== undefined) {
        reject('containerBinaryInstallOnPresent', filePath, `binaries.${name} is present, so install: is dead text.`);
    }

    return {
        name,
        status,
        version: typeof entry.version === 'string' ? entry.version : undefined,
        install: typeof entry.install === 'string' ? entry.install : undefined,
        note: typeof entry.note === 'string' ? entry.note : undefined,
        evidence,
    };
}

/** How many rows are documentation rather than observation. Reported, not enforced. */
export function countAsserted(inventory: ContainerInventory): number {
    return [...inventory.binaries.values()].filter(fact => fact.evidence === 'asserted').length;
}
