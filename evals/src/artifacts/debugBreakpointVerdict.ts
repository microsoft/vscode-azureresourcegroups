/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Decides *who is to blame* for a debug-probe verdict.
 *
 * This is the blame assignment behind `evals/graders/validate-debug-breakpoint.ts`, split out
 * so it can be certified. It is worth certifying precisely because its failure mode is silent:
 * a harness fault miscounted as a product failure is invisible and quietly poisons the corpus —
 * that is how a gate reaches 0-for-16 before anyone notices — whereas a product failure
 * miscounted as a harness fault is loud and gets investigated. Nothing about the exit-code
 * contract tells you which way a mistake went, so the mapping itself has to be pinned.
 *
 * The grader turns a disposition into its exit code:
 *   productPass    -> 0  the breakpoint was hit; F5 genuinely works in the generated project
 *   productFailure -> 1  the product produced something that cannot be debugged
 *   harnessFault   -> 3  the instrument broke, and this run says nothing about the product
 */

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { DebugProbeVerdict } from '../../debug-probe/extension/src/verdict.ts';
import { isProbeOutcome, PROBE_SCHEMA_VERSION, VERDICT_RELATIVE_PATH } from '../../debug-probe/extension/src/verdict.ts';
import { type ArtifactValidationResult, createValidationResult } from './validationTypes.ts';

export type BreakpointDisposition = 'productPass' | 'productFailure' | 'harnessFault';

export interface DebugBreakpointAdjudication {
    disposition: BreakpointDisposition;
    /** Stable identifier for the verdict reached. Empty only for `productPass`. */
    code: string;
    message: string;
    /** Printed on a pass so a green result is inspectable rather than merely asserted. */
    evidence: string[];
}

export interface DebugBreakpointOptions {
    /**
     * Treat `patternMatchedNothing` as a product failure instead of a harness fault. Opt in
     * only for a stack whose contract genuinely guarantees the thing the pattern looks for
     * (e.g. a health route), so a miss really is the product's fault.
     */
    patternMissIsProductFailure?: boolean;
}

/** Harness-fault codes are prefixed so a certification case cannot confuse blame with outcome. */
const HARNESS = 'harnessFault';

function harness(code: string, message: string): DebugBreakpointAdjudication {
    return { disposition: 'harnessFault', code: `${HARNESS}:${code}`, message, evidence: [] };
}

function productFailure(code: string, message: string): DebugBreakpointAdjudication {
    return { disposition: 'productFailure', code, message, evidence: [] };
}

function formatOutput(verdict: DebugProbeVerdict): string {
    const output = verdict.output ?? [];
    return output.length > 0 ? `\n  debuggee output:\n${output.map(line => `    ${line}`).join('\n')}` : '';
}

/** Why a pattern miss happened, phrased so it can be re-adjudicated without a re-run. */
function describePatternMiss(verdict: DebugProbeVerdict): string {
    const resolution = verdict.resolution;
    if (!resolution) {
        return 'the probe recorded no resolution detail';
    }
    if (resolution.globMatchCount === 0) {
        return `no file matched glob "${resolution.glob}" — the project may not contain the file this gate expects`;
    }
    const files = resolution.filesMatchedByGlob.join(', ');
    return `glob "${resolution.glob}" matched ${resolution.globMatchCount} file(s) [${files}] but no line matched /${resolution.pattern}/ — the pattern may be too narrow for what the agent generated`;
}

/**
 * Read the verdict and assign blame. Every ambiguous case resolves to `harnessFault`.
 */
export function adjudicateDebugBreakpoint(
    workspaceRoot: string,
    options: DebugBreakpointOptions = {},
): DebugBreakpointAdjudication {
    const absolute = path.join(workspaceRoot, ...VERDICT_RELATIVE_PATH.split('/'));

    let raw: string;
    try {
        raw = readFileSync(absolute, 'utf8');
    } catch {
        // NOT a product failure. No verdict means the probe never got far enough to render
        // one — most often because Workspace Trust blocked activation outright, which produces
        // exactly this silence. The product may be fine.
        return harness(
            'noVerdict',
            `no debug probe verdict at ${absolute}. The probe did not run to completion, so this run says nothing about the product. `
            + `Check that the probe extension installed and activated, and that the workspace was trusted.`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        return harness('unparseableVerdict', `${absolute} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (typeof parsed !== 'object' || parsed === null) {
        return harness('unparseableVerdict', `${absolute} is not an object`);
    }
    const verdict = parsed as Partial<DebugProbeVerdict>;

    if (verdict.schemaVersion !== PROBE_SCHEMA_VERSION) {
        return harness(
            'schemaDrift',
            `verdict schemaVersion is ${JSON.stringify(verdict.schemaVersion)}, expected ${PROBE_SCHEMA_VERSION} — the probe and this grader have drifted`);
    }
    // An outcome this grader does not recognise means the probe learned a new one and this
    // file was not updated. Guessing would defeat the point of the gate.
    if (!isProbeOutcome(verdict.outcome)) {
        return harness(
            'unknownOutcome',
            `verdict outcome ${JSON.stringify(verdict.outcome)} is not one this grader recognises — the probe and this grader have drifted`);
    }

    const full = verdict as DebugProbeVerdict;
    switch (full.outcome) {
        case 'hit': {
            const where = full.stopped?.file
                ? `${full.stopped.file}:${full.stopped.line} in ${full.stopped.frame ?? '<unknown frame>'}`
                : full.detail;
            const locals = Object.keys(full.stopped?.locals ?? {});
            return {
                disposition: 'productPass',
                code: '',
                message: `stopped at ${where}`,
                evidence: [
                    `stopped at ${where}`,
                    `locals in scope: ${locals.length > 0 ? locals.join(', ') : '(none captured)'}`,
                ],
            };
        }

        case 'launchConfigInvalid':
            return productFailure('launchConfigInvalid', `the generated project has no usable launch configuration — ${full.detail}`);

        case 'appFailedToStart':
            return productFailure('appFailedToStart', `the generated project did not start under the debugger — ${full.detail}${formatOutput(full)}`);

        case 'breakpointNotHit':
            // The app ran and was reachable; execution simply never arrived. Note that an
            // unverified breakpoint is NOT evidence either way: js-debug reports
            // `verified: false` at set time and rebinds once the script loads, so breakpoints
            // it calls unbound are routinely hit.
            return productFailure('breakpointNotHit', `the breakpoint was never hit — ${full.detail}${formatOutput(full)}`);

        case 'patternMatchedNothing': {
            const why = describePatternMiss(full);
            if (options.patternMissIsProductFailure) {
                return productFailure('patternMatchedNothing', `the project does not contain the code this gate breaks on — ${why}`);
            }
            return harness(
                'patternMatchedNothing',
                `the probe could not place a breakpoint, and the cause is ambiguous: ${why}. `
                + `Defaulting to a harness fault because a bad pattern and a bad project are indistinguishable from here. `
                + `Pass --pattern-miss-is-product-failure for a stack whose contract guarantees this code exists.`);
        }

        case 'probeError':
            return harness('probeError', `the debug probe itself failed: ${full.detail}`);
    }
}

/**
 * Certification adapter.
 *
 * A pass carries no issues; every other disposition carries exactly one whose code is the
 * blame verdict. That is what makes the mapping falsifiable from the manifest: a case can
 * assert `harnessFault:patternMatchedNothing` and go red the day someone reclassifies it as
 * the product's fault.
 */
export function validateDebugBreakpointVerdict(
    workspaceRoot: string,
    options: DebugBreakpointOptions = {},
): ArtifactValidationResult {
    const adjudication = adjudicateDebugBreakpoint(workspaceRoot, options);
    if (adjudication.disposition === 'productPass') {
        return createValidationResult([]);
    }
    return createValidationResult([{
        code: adjudication.code,
        path: VERDICT_RELATIVE_PATH,
        message: adjudication.message,
    }]);
}
