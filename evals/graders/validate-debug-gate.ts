/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grades the approval gate at the end of the planning phase.
 *
 * `azure-debug-plan` is contracted to produce the plan and then STOP: it must not
 * write launch/tasks configuration, a compose file, or scripts before the user has
 * approved. Generating early is the failure mode this grader exists to catch, so it
 * asserts both that the plan is present and reviewable, and that nothing downstream
 * of the gate has appeared yet.
 *
 * Flags: --assert-status=<status>   (defaults to Planning)
 */

import { existsSync } from 'node:fs';
import { validateLocalDebugPlanArtifact } from '../src/artifacts/localDebugPlan.ts';
import { fail, failWithIssues, readArtifact, runGrader, workspacePath } from './graderHarness.ts';

/**
 * Artifacts that *only* the generation phase can create.
 *
 * Compose files are deliberately absent. A scaffolded project may already ship a
 * `docker-compose.yml` for its own dependencies — `azure-debug-plan` is contracted to
 * *merge* into an existing compose file rather than overwrite it — so its presence at
 * the gate proves nothing about whether generation ran. Detecting a premature *merge*
 * would need a pre-gate baseline to diff against, which a post-hoc grader does not have.
 * These three are unambiguous: nothing upstream of the gate writes them.
 */
const POST_GATE_ARTIFACTS = [
    '.vscode/launch.json',
    '.vscode/tasks.json',
    'api-test-collections',
];

runGrader('debug planning stopped at the approval gate', () => {
    const args = process.argv.slice(2);
    const expectedStatus = args.find(arg => arg.startsWith('--assert-status='))?.split('=')[1] || 'Planning';

    const content = readArtifact('.azure/vscode-debug-plan.md');
    const result = validateLocalDebugPlanArtifact(content, { expectedStatus });
    if (!result.valid) {
        failWithIssues('debug plan is not in a reviewable state at the gate:', result.issues);
    }

    const premature = POST_GATE_ARTIFACTS.filter(relativePath => existsSync(workspacePath(relativePath)));
    if (premature.length > 0) {
        fail(`Generation ran before approval — found ${premature.join(', ')}`);
    }
});
