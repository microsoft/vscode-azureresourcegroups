/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface ProjectPlanFiles {
    hasProjectPlan: boolean;
    hasLocalDevelopmentPlan: boolean;
    hasDeploymentPlan: boolean;
}

export async function getProjectPlanFiles(): Promise<ProjectPlanFiles> {
    const [projectPlanFiles, localDevelopmentPlanFiles, deploymentPlanFiles] = await Promise.all([
        vscode.workspace.findFiles('**/project-plan.md', '**/node_modules/**', 1),
        vscode.workspace.findFiles('**/vscode-debug-plan.md', '**/node_modules/**', 1),
        vscode.workspace.findFiles('**/.azure/deployment-plan.md', '**/node_modules/**', 1),
    ]);

    return {
        hasProjectPlan: projectPlanFiles.length > 0,
        hasLocalDevelopmentPlan: localDevelopmentPlanFiles.length > 0,
        hasDeploymentPlan: deploymentPlanFiles.length > 0,
    };
}

export interface DebugConfigurationSummary {
    readonly name: string;
    readonly folder: vscode.WorkspaceFolder;
}

export function getDebugConfigurations(): DebugConfigurationSummary[] {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const results: DebugConfigurationSummary[] = [];
    for (const folder of folders) {
        const launch = vscode.workspace.getConfiguration('launch', folder.uri);
        const configs = launch.get<Array<{ name?: string; type?: string }>>('configurations');
        if (Array.isArray(configs)) {
            for (const config of configs) {
                if (config && typeof config.name === 'string' && config.name.length > 0 && config.type) {
                    results.push({ name: config.name, folder });
                }
            }
        }
        const compounds = launch.get<Array<{ name?: string; configurations?: unknown[] }>>('compounds');
        if (Array.isArray(compounds)) {
            for (const compound of compounds) {
                if (compound && typeof compound.name === 'string' && compound.name.length > 0 && Array.isArray(compound.configurations) && compound.configurations.length > 0) {
                    results.push({ name: compound.name, folder });
                }
            }
        }
    }
    return results;
}
