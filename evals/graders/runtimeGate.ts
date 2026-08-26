/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The adapter every runtime gate is built from.
 *
 * The five runtime graders differ only in which question they ask, so the parts that must
 * not vary — releasing the app, attributing the outcome, printing the diagnostics — live
 * here once rather than being re-typed five times with five chances to get teardown wrong.
 *
 * The `finally` is the important line in this file. The validators start a real server, and
 * a grader that exits without releasing it leaves a process holding a port, which breaks
 * every subsequent run on that machine for a reason that looks nothing like its cause.
 */

import type { RuntimeValidationResult } from '../src/runtime/runtimeGates.ts';
import { releaseRuntimeSessions } from '../src/runtime/runtimeSession.ts';
import { failAsHarnessFault, failWithIssues, runGraderAsync, skipAsNotApplicable, workspacePath } from './graderHarness.ts';

export function runRuntimeGate(
    gate: string,
    name: string,
    validate: (workspaceRoot: string) => Promise<RuntimeValidationResult>,
): void {
    void runGraderAsync(name, async () => {
        let result: RuntimeValidationResult;
        try {
            result = await validate(workspacePath('.'));
        } finally {
            // Runs on the success path, the failure path and the throw path alike. Teardown
            // is a correctness requirement here, not politeness.
            await releaseRuntimeSessions();
        }

        for (const diagnostic of result.diagnostics) {
            process.stderr.write(`[${gate}] ${diagnostic}\n`);
        }

        // Order matters: the validators record a not-applicable verdict and a harness fault
        // as issues *as well as* flags, so that grader certification sees them and the
        // golden fixture goes red. Here the flags win, because they carry the attribution.
        if (result.notApplicable) {
            skipAsNotApplicable(gate, result.notApplicable.reason, result.notApplicable.detail);
        }
        if (result.harnessFault) {
            failAsHarnessFault(result.harnessFault);
        }
        if (result.issues.length > 0) {
            failWithIssues('the runtime probe reported:', result.issues);
        }
    });
}
