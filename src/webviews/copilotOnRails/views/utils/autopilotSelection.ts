/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function resolveAutopilotSelection(
    currentSelection: boolean,
    userEdited: boolean,
    artifactExecutionMode: string,
): boolean {
    return userEdited
        ? currentSelection
        : artifactExecutionMode.trim().toLowerCase() === 'auto';
}
