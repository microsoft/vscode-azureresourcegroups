/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grades the seam swap — the one change `azure-project-integrate` exists to make.
 *
 * The contract lives in `evals/src/artifacts/frontendSeamLive.ts`, shared with grader
 * certification, so the certified path and the executed path cannot drift.
 *
 * Declines rather than fails when there is no frontend or no `src/api/` seam. Both are the
 * *scaffold* agent's output, and `wire-live-data.md` explicitly allows integrate to fall
 * back to a call-site rewrite when the seam is absent. Failing here would blame this agent
 * for the previous one's work, and for a fallback the product permits.
 *
 * Flags: --frontend-dir=<path> (defaults to discovery, preferring services/web)
 */

import { findApiSeam, validateFrontendSeamLive } from '../src/artifacts/frontendSeamLive.ts';
import { failWithIssues, requirePrecondition, runGraderAsync, workspacePath } from './graderHarness.ts';

void runGraderAsync('the frontend API seam points at a live client', async () => {
    const flag = process.argv.slice(2).find(arg => arg.startsWith('--frontend-dir='));
    const frontendDirectory = flag?.slice('--frontend-dir='.length);
    const workspace = workspacePath('.');

    requirePrecondition(
        'frontend-seam-live',
        'the scaffold left a frontend with a src/api/ seam',
        await findApiSeam(workspace, { frontendDirectory }) !== undefined,
        'No frontend with a `src/api/` seam was found. That seam is the scaffold agent\'s output, and '
        + 'wire-live-data.md lets integrate fall back to a call-site rewrite without one, so there is '
        + 'nothing here this gate can hold the integrate agent to.',
    );

    const result = await validateFrontendSeamLive(workspace, { frontendDirectory });
    if (!result.valid) {
        failWithIssues('frontend seam is not wired to live data:', result.issues);
    }
});
