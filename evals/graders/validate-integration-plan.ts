/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grades `.azure/integration-plan.md`, the scaffold agent's hand-off artifact.
 *
 * The contract lives in `evals/src/artifacts/integrationPlan.ts`, shared with grader
 * certification, so the certified path and the executed path cannot drift.
 *
 * Flags: --has-frontend
 */

import { validateIntegrationPlanArtifact } from '../src/artifacts/integrationPlan.ts';
import { failWithIssues, readArtifact, runGrader } from './graderHarness.ts';

runGrader('integration-plan.md satisfies the hand-off contract', () => {
    const hasFrontend = process.argv.slice(2).includes('--has-frontend');

    const result = validateIntegrationPlanArtifact(readArtifact('.azure/integration-plan.md'), { hasFrontend });
    if (!result.valid) {
        failWithIssues('integration plan contract errors:', result.issues);
    }
});
