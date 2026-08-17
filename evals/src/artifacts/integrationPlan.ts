/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ArtifactValidationIssue,
    ArtifactValidationResult,
    createValidationResult,
} from './validationTypes';

const requiredContent = [
    { code: 'missingBackend', pattern: /\bbackend\b/i, message: 'Integration plan must describe the backend project and commands.' },
    { code: 'missingRoutes', pattern: /\b(api routes?|endpoints?)\b/i, message: 'Integration plan must inventory API routes.' },
    { code: 'missingDatabase', pattern: /\b(database|data store|cosmos|blob storage|queue storage|redis)\b/i, message: 'Integration plan must describe persistence or explicitly state none.' },
    { code: 'missingServices', pattern: /\bservices?\b/i, message: 'Integration plan must list planned services.' },
    { code: 'missingNoSeedRule', pattern: /\bno seed data\b/i, message: 'Integration plan must explicitly prohibit seed data.' },
] as const;

export function validateIntegrationPlanArtifact(
    content: string,
    options: { hasFrontend: boolean },
): ArtifactValidationResult {
    const issues: ArtifactValidationIssue[] = [];
    if (content.trim().length < 200) {
        issues.push(issue('artifactTooShort', '$', 'Integration plan is too short to hand off the scaffold.'));
    }
    for (const requirement of requiredContent) {
        if (!requirement.pattern.test(content)) {
            issues.push(issue(requirement.code, '$', requirement.message));
        }
    }
    if (options.hasFrontend && !/\bfrontend\b/i.test(content)) {
        issues.push(issue('missingFrontend', '$', 'Integration plan must describe the frontend commands and API seam.'));
    }
    return createValidationResult(issues);
}

function issue(code: string, path: string, message: string): ArtifactValidationIssue {
    return { code, path, message };
}
