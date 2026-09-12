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
 * Flags:
 *   --has-frontend   also grade the Frontend and Shared types sections
 *   --no-datastore   the project declares no datastore, so do not demand a Database
 *                    section. Deliberately a negative flag: absence must keep the
 *                    gate strict, or a flag nobody passes silently weakens it.
 */

import { validateIntegrationPlanArtifact } from '../src/artifacts/integrationPlan.ts';
import { failWithIssues, readArtifact, runGrader } from './graderHarness.ts';

runGrader('integration-plan.md satisfies the hand-off contract', () => {
    const flags = process.argv.slice(2);
    const hasFrontend = flags.includes('--has-frontend');
    const hasDatastore = !flags.includes('--no-datastore');

    const result = validateIntegrationPlanArtifact(readArtifact('.azure/integration-plan.md'), { hasFrontend, hasDatastore });
    if (!result.valid) {
        failWithIssues('integration plan contract errors:', result.issues);
    }
});
