/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grades `.eval/debug-verdict.json`, written by the debug probe extension
 * (`evals/debug-probe/`) while it ran inside real VS Code.
 *
 * This grader does not decide whether the breakpoint was hit — it cannot, from
 * outside the extension host. It decides *who is to blame* for the probe's
 * verdict, which is the part that has to be right. The exit-code contract from
 * `graderHarness` is doing real work here:
 *
 *   0  the breakpoint was hit; F5 genuinely works in the generated project
 *   1  the product produced something that cannot be debugged
 *   3  the instrument broke, and this run says nothing about the product
 *
 * Every ambiguous case resolves to 3. The asymmetry is deliberate: a harness
 * fault miscounted as a product failure is invisible and quietly poisons the
 * corpus — that is exactly how a gate reaches 0-for-16 before anyone notices —
 * whereas a product failure miscounted as a harness fault is loud and gets
 * investigated.
 *
 * Flags:
 *   --pattern-miss-is-product-failure
 *       Treat `patternMatchedNothing` as exit 1 instead of exit 3. Opt in only
 *       for a stack whose contract genuinely guarantees the thing the pattern
 *       looks for (e.g. a health route), so a miss really is the product's fault.
 */

import { readFileSync } from 'node:fs';
import { fail, runGrader, workspacePath } from './graderHarness.ts';
import type { DebugProbeVerdict } from '../debug-probe/extension/src/verdict.ts';
import { isProbeOutcome, PROBE_SCHEMA_VERSION, VERDICT_RELATIVE_PATH } from '../debug-probe/extension/src/verdict.ts';

/**
 * Exit 3, with the message as the whole diagnosis.
 *
 * `runGrader` prints `error.stack` for anything that is not a `ProductFailure`.
 * For a deliberate harness verdict the message *is* the finding, and a JS stack
 * pointing at this line would tell the reader nothing, so it is replaced.
 */
function harnessFault(message: string): never {
    const error = new Error(message);
    error.stack = message;
    throw error;
}

function readVerdict(): DebugProbeVerdict {
    const absolute = workspacePath(VERDICT_RELATIVE_PATH);
    let raw: string;
    try {
        raw = readFileSync(absolute, 'utf8');
    } catch {
        // NOT a product failure. No verdict means the probe never got far enough
        // to render one — most often because Workspace Trust blocked activation
        // outright, which produces exactly this silence. The product may be fine.
        harnessFault(
            `no debug probe verdict at ${absolute}. The probe did not run to completion, so this run says nothing about the product. ` +
            `Check that the probe extension installed and activated, and that the workspace was trusted.`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        harnessFault(`${absolute} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (typeof parsed !== 'object' || parsed === null) {
        harnessFault(`${absolute} is not an object`);
    }
    const verdict = parsed as Partial<DebugProbeVerdict>;

    if (verdict.schemaVersion !== PROBE_SCHEMA_VERSION) {
        harnessFault(`verdict schemaVersion is ${JSON.stringify(verdict.schemaVersion)}, expected ${PROBE_SCHEMA_VERSION} — the probe and this grader have drifted`);
    }
    // An outcome this grader does not recognise means the probe learned a new one
    // and this file was not updated. Guessing would defeat the point of the gate.
    if (!isProbeOutcome(verdict.outcome)) {
        harnessFault(`verdict outcome ${JSON.stringify(verdict.outcome)} is not one this grader recognises — the probe and this grader have drifted`);
    }
    return verdict as DebugProbeVerdict;
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

runGrader('a breakpoint is hit in the generated project', () => {
    const patternMissIsProductFailure = process.argv.slice(2).includes('--pattern-miss-is-product-failure');
    const verdict = readVerdict();

    switch (verdict.outcome) {
        case 'hit': {
            // Report the evidence, so a green result is inspectable rather than merely asserted.
            const where = verdict.stopped?.file
                ? `${verdict.stopped.file}:${verdict.stopped.line} in ${verdict.stopped.frame ?? '<unknown frame>'}`
                : verdict.detail;
            const locals = Object.keys(verdict.stopped?.locals ?? {});
            console.error(`  stopped at ${where}`);
            console.error(`  locals in scope: ${locals.length > 0 ? locals.join(', ') : '(none captured)'}`);
            return;
        }

        case 'launchConfigInvalid':
            fail(`the generated project has no usable launch configuration — ${verdict.detail}`);
            break;

        case 'appFailedToStart':
            fail(`the generated project did not start under the debugger — ${verdict.detail}${formatOutput(verdict)}`);
            break;

        case 'breakpointNotHit':
            // The app ran and was reachable; execution simply never arrived. Note
            // that an unverified breakpoint is NOT evidence either way: js-debug
            // reports `verified: false` at set time and rebinds once the script
            // loads, so breakpoints it calls unbound are routinely hit.
            fail(`the breakpoint was never hit — ${verdict.detail}${formatOutput(verdict)}`);
            break;

        case 'patternMatchedNothing': {
            const why = describePatternMiss(verdict);
            if (patternMissIsProductFailure) {
                fail(`the project does not contain the code this gate breaks on — ${why}`);
            }
            harnessFault(
                `the probe could not place a breakpoint, and the cause is ambiguous: ${why}. ` +
                `Defaulting to a harness fault because a bad pattern and a bad project are indistinguishable from here. ` +
                `Pass --pattern-miss-is-product-failure for a stack whose contract guarantees this code exists.`);
            break;
        }

        case 'probeError':
            harnessFault(`the debug probe itself failed: ${verdict.detail}`);
            break;
    }
});

function formatOutput(verdict: DebugProbeVerdict): string {
    const output = verdict.output ?? [];
    return output.length > 0 ? `\n  debuggee output:\n${output.map(line => `    ${line}`).join('\n')}` : '';
}
