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

        const folders = vscode.workspace.workspaceFolders ?? [];
        const hasWorkspace = folders.length > 0;
        context.telemetry.properties.hasWorkspace = String(hasWorkspace);
        if (!hasWorkspace) {
            context.telemetry.properties.hasAzureYaml = 'false';
            context.telemetry.properties.isGitRepo = 'false';
            return;
        }

        const [matches, isGitRepo] = await Promise.all([
            vscode.workspace.findFiles('**/azure.{yaml,yml}', excludePattern, 1),
            hasGitFolder(folders),
        ]);
        context.telemetry.properties.hasAzureYaml = String(matches.length > 0);
        context.telemetry.properties.isGitRepo = String(isGitRepo);
    });
}

// `.git` is a directory in normal clones but a file in worktrees and submodules, so a stat covers both
async function hasGitFolder(folders: readonly vscode.WorkspaceFolder[]): Promise<boolean> {
    const results = await Promise.all(folders.map(async folder => {
        try {
            await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, '.git'));
            return true;
        } catch {
            return false;
        }
    }));
    return results.some(Boolean);
}
