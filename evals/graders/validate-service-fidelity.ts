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
import { failWithIssues, notApplicable, readArtifact, runGraderAsync, workspacePath } from './graderHarness.ts';

const NOT_APPLICABLE_CODES = new Set(['ecosystemNotSupported']);

void runGraderAsync('scaffolded services match the ones the plan declared', async () => {
    const planMarkdown = readArtifact('.azure/project-plan.md');
    const result = await validateServiceFidelity(workspacePath('.'), planMarkdown);
    if (result.valid) {
        return;
    }

    const blocking = result.issues.filter(value => !NOT_APPLICABLE_CODES.has(value.code));
    if (blocking.length === 0) {
        const reason = result.issues[0];
        notApplicable(reason.code, reason.message, ecosystemFact(planMarkdown));
    }
    failWithIssues('service fidelity errors:', blocking);
});

/**
 * Attach the plan's own languages to a not-applicable verdict, so an unsupported stack
 * collapses to one actionable line — "the Go analyser is missing" — rather than a pile of
 * individually uninformative skips that nobody can group.
 */
function ecosystemFact(planMarkdown: string): Record<string, string> {
    const languages = [...new Set(readPlannedProject(planMarkdown).services
        .map(service => service.language?.trim().toLowerCase())
        .filter((language): language is string => !!language))];
    return languages.length > 0 ? { plannedLanguages: languages.join('+') } : {};
}
