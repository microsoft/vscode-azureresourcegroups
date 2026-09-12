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
 * verdict, which is the part that has to be right. That blame assignment lives in
 * `evals/src/artifacts/debugBreakpointVerdict.ts`, shared with grader certification
 * so the certified path and the executed path cannot drift.
 *
 * The exit-code contract from `graderHarness` is doing real work here:
 *
 *   0  the breakpoint was hit; F5 genuinely works in the generated project
 *   1  the product produced something that cannot be debugged
 *   3  the instrument broke, and this run says nothing about the product
 *
 * Every ambiguous case resolves to 3. The asymmetry is deliberate: a harness
 * fault miscounted as a product failure is invisible and quietly poisons the
 * corpus — that is exactly how a gate reaches 0-for-16 before anyone notices -
 * whereas a product failure miscounted as a harness fault is loud and gets
 * investigated.
 *
 * Flags:
 *   --pattern-miss-is-product-failure
 *       Treat `patternMatchedNothing` as exit 1 instead of exit 3. Opt in only
 *       for a stack whose contract genuinely guarantees the thing the pattern
 *       looks for (e.g. a health route), so a miss really is the product's fault.
 */

import { adjudicateDebugBreakpoint } from '../src/artifacts/debugBreakpointVerdict.ts';
import { fail, runGrader, workspacePath } from './graderHarness.ts';

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

runGrader('a breakpoint is hit in the generated project', () => {
    const patternMissIsProductFailure = process.argv.slice(2).includes('--pattern-miss-is-product-failure');
    const adjudication = adjudicateDebugBreakpoint(workspacePath('.'), { patternMissIsProductFailure });

    switch (adjudication.disposition) {
        case 'productPass':
            // Report the evidence, so a green result is inspectable rather than merely asserted.
            for (const line of adjudication.evidence) {
                console.error(`  ${line}`);
            }
            return;
        case 'productFailure':
            fail(adjudication.message);
            break;
        case 'harnessFault':
            harnessFault(adjudication.message);
    }
});