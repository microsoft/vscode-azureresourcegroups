/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grades the frontend the scaffold agent generated — preview embeddability and API-seam
 * integrity. The contract lives in `evals/src/artifacts/frontendScaffold.ts`, shared with
 * grader certification, so the certified path and the executed path cannot drift.
 *
 * Flags: --frontend-dir=<path> (defaults to discovery, preferring services/web)
 */

import { validateFrontendScaffold } from '../src/artifacts/frontendScaffold.ts';
import { failWithIssues, runGrader, workspacePath } from './graderHarness.ts';

runGrader('scaffolded frontend is preview-embeddable and keeps the API seam', async () => {
    const flag = process.argv.slice(2).find(arg => arg.startsWith('--frontend-dir='));
    const frontendDirectory = flag?.slice('--frontend-dir='.length);

    const result = await validateFrontendScaffold(workspacePath('.'), { frontendDirectory });
    if (!result.valid) {
        failWithIssues('frontend scaffold contract errors:', result.issues);
    }
});
