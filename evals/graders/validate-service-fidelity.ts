/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grades whether the scaffold contains the services the plan promised, and only those.
 *
 * The contract lives in `evals/src/artifacts/serviceFidelity.ts`, shared with grader
 * certification, so the certified path and the executed path cannot drift.
 *
 * Arm-neutral: it compares a plan to a tree and never looks at how either was produced, so
 * a baseline (non-Rails) run that wrote a plan can be scored on it too.
 */

import { readPlannedProject } from '../src/artifacts/plannedProject.ts';
import { validateServiceFidelity } from '../src/artifacts/serviceFidelity.ts';
import { failWithIssues, gateId, readArtifact, runGraderAsync, skipAsNotApplicable, workspacePath } from './graderHarness.ts';

/**
 * This family's reason vocabulary, with the class each code implies. Kept local rather than
 * in a shared registry so adding a fidelity reason never collides with another gate family
 * doing the same thing — but still a table, so a code cannot reach the marker unclassified.
 */
const FIDELITY_NOT_APPLICABLE = { ecosystemNotSupported: 'coverageGap' } as const;

void runGraderAsync('scaffolded services match the ones the plan declared', async () => {
    const planMarkdown = readArtifact('.azure/project-plan.md');
    const result = await validateServiceFidelity(workspacePath('.'), planMarkdown);
    if (result.valid) {
        return;
    }

    const blocking = result.issues.filter(value => !(value.code in FIDELITY_NOT_APPLICABLE));
    if (blocking.length === 0) {
        const reason = result.issues[0].code as keyof typeof FIDELITY_NOT_APPLICABLE;
        skipAsNotApplicable(gateId(), FIDELITY_NOT_APPLICABLE[reason], reason, describeSkip(planMarkdown, result.issues[0].message));
    }
    failWithIssues('service fidelity errors:', blocking);
});

/**
 * Name the languages the plan asked for alongside the reason, so a coverage hole collapses
 * to one actionable line — "the Go analyser is missing" — rather than a pile of
 * individually uninformative skips that nobody can group.
 */
function describeSkip(planMarkdown: string, message: string): string {
    const languages = [...new Set(readPlannedProject(planMarkdown).services
        .map(service => service.language?.trim().toLowerCase())
        .filter((language): language is string => !!language))];
    return languages.length > 0 ? `${message} Plan languages: ${languages.join(', ')}.` : message;
}
