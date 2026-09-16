/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ProbeSpec } from './verdict';

/** A malformed spec is our fault, not the product's — it becomes `probeError`. */
export class SpecError extends Error { }

function requireString(container: Record<string, unknown>, key: string, where: string): string {
    const value = container[key];
    if (typeof value !== 'string' || value.trim() === '') {
        throw new SpecError(`${where}.${key} must be a non-empty string, got ${JSON.stringify(value)}`);
    }
    return value;
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new SpecError(`${where} must be an object, got ${JSON.stringify(value)}`);
    }
    return value as Record<string, unknown>;
}

/**
 * Validate the spec up front rather than discovering it is wrong halfway through
 * a debug session. Everything wrong here is a harness fault, so it is worth being
 * noisy and specific about which key is bad.
 */
export function parseProbeSpec(raw: unknown): ProbeSpec {
    const root = asRecord(raw, 'debug-probe.json');
    const launchConfig = requireString(root, 'launchConfig', 'debug-probe.json');

    const breakpoint = asRecord(root.breakpoint, 'debug-probe.json.breakpoint');
    const glob = requireString(breakpoint, 'glob', 'breakpoint');
    const pattern = requireString(breakpoint, 'pattern', 'breakpoint');
    try {
        // Compile now so a bad regex is reported as a spec error rather than
        // surfacing later as "matched nothing", which means something else.
        void new RegExp(pattern);
    } catch (error) {
        throw new SpecError(`breakpoint.pattern is not a valid regex: ${error instanceof Error ? error.message : String(error)}`);
    }

    const spec: ProbeSpec = { launchConfig, breakpoint: { glob, pattern } };

    if (root.trigger !== undefined) {
        const trigger = asRecord(root.trigger, 'debug-probe.json.trigger');
        spec.trigger = { url: requireString(trigger, 'url', 'trigger') };
    }
    if (root.timeoutMs !== undefined) {
        if (typeof root.timeoutMs !== 'number' || !Number.isFinite(root.timeoutMs) || root.timeoutMs <= 0) {
            throw new SpecError(`timeoutMs must be a positive number, got ${JSON.stringify(root.timeoutMs)}`);
        }
        spec.timeoutMs = root.timeoutMs;
    }
    if (root.exitWhenDone !== undefined) {
        if (typeof root.exitWhenDone !== 'boolean') {
            throw new SpecError(`exitWhenDone must be a boolean, got ${JSON.stringify(root.exitWhenDone)}`);
        }
        spec.exitWhenDone = root.exitWhenDone;
    }
    return spec;
}
