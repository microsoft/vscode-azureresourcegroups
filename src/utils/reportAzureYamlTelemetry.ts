/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';

// Dependency, virtual environment, and build output folders that never hold a project's own azure.yaml
const excludedFolders = [
    'node_modules', '.git', '.venv', 'venv', '.env', 'env', '__pycache__', 'site-packages',
    'bin', 'obj', 'dist', 'out', 'build', 'target', 'vendor', '.terraform', '.azure',
];
const excludePattern = `**/{${excludedFolders.join(',')}}/**`;

/**
 * Reports whether the open workspace contains an azure.yaml file.
 * Intended to be called without awaiting so it never blocks activation.
 */
export async function reportAzureYamlTelemetry(): Promise<void> {
    await callWithTelemetryAndErrorHandling('azureResourceGroups.workspaceHasAzureYaml', async (context: IActionContext) => {
        context.telemetry.properties.isActivationEvent = 'true';
        context.errorHandling.suppressDisplay = true;

        const hasWorkspace = !!vscode.workspace.workspaceFolders?.length;
        context.telemetry.properties.hasWorkspace = String(hasWorkspace);
        if (!hasWorkspace) {
            context.telemetry.properties.hasAzureYaml = 'false';
            return;
        }

        const matches = await vscode.workspace.findFiles('**/azure.yaml', excludePattern, 1);
        context.telemetry.properties.hasAzureYaml = String(matches.length > 0);
    });
}
