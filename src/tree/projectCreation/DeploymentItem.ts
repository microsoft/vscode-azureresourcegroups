/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { GenericItem } from '../GenericItem';
import { ResourceGroupsItem } from '../ResourceGroupsItem';

const planFileDir = '.azure';
const planFileName = 'plan.md';

export class DeploymentItem implements ResourceGroupsItem {
    readonly id = 'projectCreation/deployment';
    private cachedChildren?: ResourceGroupsItem[];

    getTreeItem(): vscode.TreeItem {
        const item = new vscode.TreeItem('Deployment', vscode.TreeItemCollapsibleState.Collapsed);
        item.contextValue = 'projectCreationPhase';
        item.iconPath = new vscode.ThemeIcon('cloud-upload', new vscode.ThemeColor('charts.green'));
        item.description = 'Phase 3 \u2014 Deploy to Azure';
        item.tooltip = '$(info) Deploy to Azure\n\nProvision your Azure resources, set up CI/CD pipelines, and ship your application to the cloud.';
        return item;
    }

    getChildren(): vscode.ProviderResult<ResourceGroupsItem[]> {
        if (this.cachedChildren) {
            return this.cachedChildren;
        }
        return this.buildChildren();
    }

    clearCache(): void {
        this.cachedChildren = undefined;
    }

    private async buildChildren(): Promise<ResourceGroupsItem[]> {
        const planContent = await readWorkspaceFile(`${planFileDir}/${planFileName}`);

        if (!planContent) {
            const children: ResourceGroupsItem[] = [
                new GenericItem('Configure Project for Azure', {
                    id: 'projectCreation/deployment/setup',
                    contextValue: 'projectCreationAction',
                    iconPath: new vscode.ThemeIcon('gear', new vscode.ThemeColor('charts.green')),
                    tooltip: 'Prepare your project for Azure deployment by generating infrastructure code, azure.yaml, and Dockerfiles.',
                    commandId: 'azureProjectCreation.setupDeployment',
                }),
            ];
            this.cachedChildren = children;
            return children;
        }

        const children: ResourceGroupsItem[] = [
            new GenericItem('Deploy Plan', {
                id: 'projectCreation/deployment/deployPlan',
                contextValue: 'projectCreationPlanFile',
                iconPath: new vscode.ThemeIcon('file-text'),
                description: `.azure/plan.md`,
                commandId: 'azureProjectCreation.openDeployPlan',
            }),
            new GenericItem('Deploy Application', {
                id: 'projectCreation/deployment/deploy',
                contextValue: 'projectCreationStep',
                iconPath: new vscode.ThemeIcon('cloud-upload', new vscode.ThemeColor('charts.green')),
                tooltip: 'Deploy your application to Azure using `azd up` or your configured CI/CD pipeline.',
            }),
        ];

        this.cachedChildren = children;
        return children;
    }
}

async function readWorkspaceFile(pattern: string): Promise<string | undefined> {
    const files = await vscode.workspace.findFiles(pattern, null, 1);
    if (files.length === 0) { return undefined; }
    const content = await vscode.workspace.fs.readFile(files[0]);
    return Buffer.from(content).toString('utf-8');
}
