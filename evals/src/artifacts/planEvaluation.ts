/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ArtifactValidationIssue, ArtifactValidationResult } from './validationTypes';

export interface PlanGateState {
    called: boolean;
    previewManifestPresentAtCall?: boolean;
    previewHtmlFilesAtCall?: string[];
}

export function validatePlanEvaluationContract(
    expectedFrontend: boolean,
    generatedFrontend: boolean,
    planGate: PlanGateState,
): ArtifactValidationResult {
    const issues: ArtifactValidationIssue[] = [];
    if (expectedFrontend !== generatedFrontend) {
        issues.push({
            code: 'frontendIntentMismatch',
            path: 'plan.appType',
            message: expectedFrontend
                ? 'Scenario requires a frontend, but the generated plan is API-only or a background worker.'
                : 'Scenario is backend-only, but the generated plan includes a frontend.',
        });
    }
    if (expectedFrontend && !planGate.previewManifestPresentAtCall) {
        issues.push({
            code: 'previewManifestMissingAtGate',
            path: 'plan.openPlanView',
            message: 'Frontend preview manifest must exist before open_plan_view is called.',
        });
    }
    if (expectedFrontend && planGate.previewHtmlFilesAtCall?.length) {
        issues.push({
            code: 'previewRenderedBeforeGate',
            path: 'plan.openPlanView',
            message: `open_plan_view must be called before preview HTML is rendered: ${planGate.previewHtmlFilesAtCall.join(', ')}.`,
        });
    }
    return {
        valid: issues.length === 0,
        issues,
    };
}
