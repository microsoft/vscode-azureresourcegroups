/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grades `.azure/project-plan.md` against the certified project-plan validator.
 *
 * Structure, numbering, required sections and the route table live in
 * `evals/src/artifacts/projectPlan.ts`, shared with grader certification.
 *
 * Flags: --expect-status=<status>
 */

import { validateProjectPlanArtifact } from '../src/artifacts/projectPlan.ts';
import { failWithIssues, readArtifact, runGrader } from './graderHarness.ts';

runGrader('project-plan.md satisfies the plan contract', () => {
    const expectedStatus = process.argv.slice(2)
        .find(arg => arg.startsWith('--expect-status='))
        ?.split('=')[1];

    const result = validateProjectPlanArtifact(readArtifact('.azure/project-plan.md'), { expectedStatus });
    if (!result.valid) {
        failWithIssues('project plan structure errors:', result.issues);
    }
});
