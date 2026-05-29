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
