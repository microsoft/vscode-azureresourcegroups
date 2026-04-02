/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DeploymentItem } from './DeploymentItem';
import { GenericItem } from '../GenericItem';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { LocalDevelopmentItem } from './LocalDevelopmentItem';

export class ProjectCreationTreeDataProvider implements vscode.TreeDataProvider<ResourceGroupsItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<ResourceGroupsItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private readonly phases: ResourceGroupsItem[];
    private readonly deploymentItem: DeploymentItem;
    private readonly parentMap = new Map<ResourceGroupsItem, ResourceGroupsItem>();
    private readonly completedSteps = new Set<string>();

    constructor() {
        this.deploymentItem = new DeploymentItem();
        this.phases = [
            new GenericItem('Plan', {
                id: 'projectCreation/plan',
                contextValue: 'projectCreationPhase',
                iconPath: new vscode.ThemeIcon('notebook', new vscode.ThemeColor('charts.purple')),
                description: 'Phase 1 \u2014 Define your project requirements',
                tooltip: this.createPhaseTooltip(
                    'Plan Your Project',
                    'Define your project goals and scaffold your project.',
                    ['Define Plan', 'Scaffold Project'],
                ),
                collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                children: [
                    new GenericItem('Create and Approve Plan', {
                        id: 'projectCreation/plan/definePlan',
                        contextValue: 'projectCreationPlanStep',
                        tooltip: this.createStepTooltip('Create and Approve Plan', 'Define your application type, target audience, scalability needs, and key constraints. Right-click to open the project plan.'),
                        checkboxState: vscode.TreeItemCheckboxState.Unchecked,
                    }),
                    new GenericItem('Scaffold Project', {
                        id: 'projectCreation/plan/scaffold',
                        contextValue: 'projectCreationStep',
                        checkboxState: vscode.TreeItemCheckboxState.Unchecked,
                    }),
                ],
            }),
            new LocalDevelopmentItem(),
            new GenericItem('Testing', {
                id: 'projectCreation/testing',
                contextValue: 'projectCreationPhase',
                iconPath: new vscode.ThemeIcon('beaker', new vscode.ThemeColor('charts.yellow')),
                description: 'Phase 3 \u2014 Create and run tests',
                tooltip: this.createPhaseTooltip(
                    'Testing',
                    'Write and run tests to ensure your application works correctly before deploying.',
                    ['Create Tests'],
                ),
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                children: [
                    new GenericItem('Create Tests', {
                        id: 'projectCreation/testing/createTests',
                        contextValue: 'projectCreationStep',
                        iconPath: new vscode.ThemeIcon('test-view-icon', new vscode.ThemeColor('charts.yellow')),
                        tooltip: this.createStepTooltip('Create Tests', 'Write unit, integration, and end-to-end tests to validate your application behavior.'),
                    }),
                ],
            }),
            this.deploymentItem,
        ];

        this.buildParentMap(this.phases);
    }

    private buildParentMap(items: ResourceGroupsItem[], parent?: ResourceGroupsItem): void {
        for (const item of items) {
            if (parent) {
                this.parentMap.set(item, parent);
            }
            const children = item.getChildren();
            if (Array.isArray(children)) {
                this.buildParentMap(children, item);
            }
        }
    }

    private createPhaseTooltip(title: string, description: string, steps: string[]): string {
        const stepList = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
        return `$(info) ${title}\n\n${description}\n\nSteps:\n${stepList}`;
    }

    private createStepTooltip(title: string, description: string): string {
        return `${title}\n\n${description}`;
    }

    findItemById(id: string): ResourceGroupsItem | undefined {
        const findRecursive = (items: ResourceGroupsItem[]): ResourceGroupsItem | undefined => {
            for (const item of items) {
                if (item.id === id) { return item; }
                const children = item.getChildren();
                if (Array.isArray(children)) {
                    const found = findRecursive(children);
                    if (found) { return found; }
                }
            }
            return undefined;
        };
        return findRecursive(this.phases);
    }

    getFirstPhase(): ResourceGroupsItem | undefined {
        return this.phases[0];
    }

    completeStep(stepId: string): void {
        this.completedSteps.add(stepId);
        this._onDidChangeTreeData.fire();
    }

    uncompleteStep(stepId: string): void {
        if (this.completedSteps.delete(stepId)) {
            this._onDidChangeTreeData.fire();
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    refreshDeployment(): void {
        this.deploymentItem.clearCache();
        this._onDidChangeTreeData.fire(this.deploymentItem);
    }

    getTreeItem(element: ResourceGroupsItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        const treeItemOrPromise = element.getTreeItem();
        const applyCheckbox = (treeItem: vscode.TreeItem): vscode.TreeItem => {
            treeItem.id = element.id;
            if (this.completedSteps.has(element.id) && treeItem.checkboxState !== undefined) {
                treeItem.checkboxState = vscode.TreeItemCheckboxState.Checked;
            }
            return treeItem;
        };

        if (treeItemOrPromise instanceof Promise || (treeItemOrPromise as Thenable<vscode.TreeItem>).then) {
            return (treeItemOrPromise as Thenable<vscode.TreeItem>).then(applyCheckbox);
        }
        return applyCheckbox(treeItemOrPromise as vscode.TreeItem);
    }

    getParent(element: ResourceGroupsItem): ResourceGroupsItem | undefined {
        return this.parentMap.get(element);
    }

    getChildren(element?: ResourceGroupsItem): vscode.ProviderResult<ResourceGroupsItem[]> {
        if (!element) {
            return this.phases;
        }

        const result = element.getChildren();

        // Handle async children by building parent mappings when they resolve
        if (result && typeof (result as Thenable<ResourceGroupsItem[]>).then === 'function') {
            return (result as Thenable<ResourceGroupsItem[]>).then((children) => {
                if (children) {
                    this.buildParentMap(children, element);
                }
                return children;
            });
        }

        return result;
    }
}
