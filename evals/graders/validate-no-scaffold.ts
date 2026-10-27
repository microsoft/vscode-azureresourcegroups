/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grades the refusal gate positively: when the plan is not approved, the agent must not
 * have scaffolded anything.
 *
 * The contract lives in `evals/src/artifacts/scaffoldAbsence.ts`, shared with grader
 * certification, so the certified path and the executed path cannot drift.
 */

import { MAX_REPORTED_SCAFFOLD_ARTIFACTS, validateScaffoldAbsence } from '../src/artifacts/scaffoldAbsence.ts';
import { fail, runGrader, workspacePath } from './graderHarness.ts';

runGrader('agent does not scaffold from an unapproved plan', () => {
    const result = validateScaffoldAbsence(workspacePath('.'));
    if (!result.valid) {
        const shown = result.issues.map(issue => issue.path);
        const more = shown.length >= MAX_REPORTED_SCAFFOLD_ARTIFACTS ? `\n  … and more` : '';
        fail(
            'The plan is not approved, so the agent must stop without scaffolding — '
            + `but it authored project files:\n${shown.map(f => `  • ${f}`).join('\n')}${more}`,
        );
    }
});