/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grades the generated workspace against the plan that specified it.
 *
 * The plan is the contract: every row marked `[x]` must have produced exactly one
 * artifact, and every row marked `[ ]` must have produced none. This grader catches
 * the case where generation quietly diverges from what the user approved.
 */

import { validateDebugArtifacts } from '../src/artifacts/debugArtifacts.ts';
import { failWithIssues, runGraderAsync, workspacePath } from './graderHarness.ts';

await runGraderAsync('generated debug artifacts match the approved plan', async () => {
    const result = await validateDebugArtifacts(workspacePath('.'));
    if (!result.valid) {
        failWithIssues('plan/artifact conformance errors:', result.issues);
    }
});
