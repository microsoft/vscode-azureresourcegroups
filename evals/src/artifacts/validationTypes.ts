/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ArtifactValidationIssue {
    code: string;
    path: string;
    message: string;
}

export interface ArtifactValidationResult {
    valid: boolean;
    issues: ArtifactValidationIssue[];
}

export function createValidationResult(issues: ArtifactValidationIssue[]): ArtifactValidationResult {
    return {
        valid: issues.length === 0,
        issues,
    };
}
