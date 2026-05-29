/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getProjectPlanFiles } from './projectPlanFiles';

type ProgressState = 'completed' | 'current' | 'notStarted';

interface StageNode {
    readonly kind: 'stage';
    readonly id: string;
    readonly label: string;
    readonly stepNumber: number;
    readonly state: ProgressState;
    readonly hasPlanFile: boolean;
    readonly openPlanCommandId: string;
    readonly startCommandId: string;
}

interface ActionNode {
    readonly kind: 'action';
    readonly id: string;
    readonly label: string;
    readonly description?: string;
    readonly iconName: string;
    readonly commandId?: string;
}

type ProgressNode = StageNode | ActionNode;

export class AzureProjectProgressTreeDataProvider implements vscode.TreeDataProvider<ProgressNode>, vscode.Disposable {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ProgressNode | undefined | void>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    private readonly disposables: vscode.Disposable[] = [];

    constructor(context: vscode.ExtensionContext) {
        this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()));
        this.disposables.push(vscode.workspace.onDidCreateFiles(() => this.refresh()));
        this.disposables.push(vscode.workspace.onDidDeleteFiles(() => this.refresh()));
        this.disposables.push(vscode.workspace.onDidRenameFiles(() => this.refresh()));

        const watchers = [
            vscode.workspace.createFileSystemWatcher('**/project-plan.md'),
            vscode.workspace.createFileSystemWatcher('**/vscode-debug-plan.md'),
            vscode.workspace.createFileSystemWatcher('**/.azure/deployment-plan.md'),
        ];

        for (const watcher of watchers) {
            watcher.onDidCreate(() => this.refresh());
            watcher.onDidDelete(() => this.refresh());
            watcher.onDidChange(() => this.refresh());
            this.disposables.push(watcher);
        }

        context.subscriptions.push(this);
    }

    dispose(): void {
        this.onDidChangeTreeDataEmitter.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

    refresh(): void {
        this.onDidChangeTreeDataEmitter.fire();
    }

    getTreeItem(element: ProgressNode): vscode.TreeItem {
        if (element.kind === 'stage') {
            const item = new vscode.TreeItem(
                vscode.l10n.t('{0}. {1}', element.stepNumber.toString(), element.label),
                vscode.TreeItemCollapsibleState.Expanded,
            );
            item.id = element.id;
            item.description = toStageDescription(element.state, element.hasPlanFile);
            item.iconPath = new vscode.ThemeIcon(toStageIconName(element.id));
            return item;
        }

        const actionItem = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        actionItem.id = element.id;
        actionItem.iconPath = new vscode.ThemeIcon(element.iconName);

        if (element.commandId) {
            actionItem.command = {
                command: element.commandId,
                title: '',
            };
        }

        return actionItem;
    }

    async getChildren(element?: ProgressNode): Promise<ProgressNode[]> {
        if (!element) {
            return this.getStageNodes();
        }

        if (element.kind === 'stage') {
            return this.getActionNodes(element);
        }

        return [];
    }

    private async getStageNodes(): Promise<StageNode[]> {
        const files = await getProjectPlanFiles();

        // When no plan files exist, return no nodes so VS Code renders the
        // configured viewsWelcome content (the "Create New Project With Copilot" button).
        if (!files.hasProjectPlan && !files.hasLocalDevelopmentPlan && !files.hasDeploymentPlan) {
            return [];
        }

        const currentStep = files.hasDeploymentPlan ? 2 : files.hasLocalDevelopmentPlan ? 1 : 0;

        return [
            {
                kind: 'stage',
                id: 'azureProject.stage.projectCreation',
                label: vscode.l10n.t('Project Creation'),
                stepNumber: 1,
                state: getState(0, currentStep),
                hasPlanFile: files.hasProjectPlan,
                openPlanCommandId: 'azureResourceGroups.openPlanView',
                startCommandId: 'azureResourceGroups.createProjectWithCopilot',
            },
            {
                kind: 'stage',
                id: 'azureProject.stage.localDevelopment',
                label: vscode.l10n.t('Local Development'),
                stepNumber: 2,
                state: getState(1, currentStep),
                hasPlanFile: files.hasLocalDevelopmentPlan,
                openPlanCommandId: 'azureResourceGroups.openLocalPlanView',
                startCommandId: 'azureResourceGroups.startLocalDevelopment',
            },
            {
                kind: 'stage',
                id: 'azureProject.stage.deployment',
                label: vscode.l10n.t('Deployment'),
                stepNumber: 3,
                state: getState(2, currentStep),
                hasPlanFile: files.hasDeploymentPlan,
                openPlanCommandId: 'azureResourceGroups.openDeployPlanView',
                startCommandId: 'azureResourceGroups.startDeployment',
            },
        ];
    }

    private getActionNodes(stage: StageNode): ActionNode[] {
        const actions: ActionNode[] = [];

        if (stage.hasPlanFile) {
            actions.push({
                kind: 'action',
                id: `${stage.id}.openPlan`,
                label: vscode.l10n.t('Open plan'),
                iconName: 'go-to-file',
                commandId: stage.openPlanCommandId,
            });
        }

        if (!stage.hasPlanFile) {
            actions.push({
                kind: 'action',
                id: `${stage.id}.start`,
                label: vscode.l10n.t('Run this stage'),
                iconName: 'run',
                commandId: stage.startCommandId,
            });
        }

        if (stage.hasPlanFile && stage.state === 'current') {
            actions.push({
                kind: 'action',
                id: `${stage.id}.continue`,
                label: vscode.l10n.t('Continue stage'),
                iconName: 'run',
                commandId: stage.startCommandId,
            });
        }

        if (actions.length === 0) {
            actions.push({
                kind: 'action',
                id: `${stage.id}.none`,
                label: vscode.l10n.t('No actions available'),
                iconName: 'info',
            });
        }

        return actions;
    }
}

function getState(stepIndex: number, currentStep: number): ProgressState {
    if (stepIndex < currentStep) {
        return 'completed';
    }

    if (stepIndex === currentStep) {
        return 'current';
    }

    return 'notStarted';
}

function toStageDescription(state: ProgressState, _hasPlanFile: boolean): string {
    return toStateText(state);
}

function toStateText(state: ProgressState): string {
    switch (state) {
        case 'completed':
            return vscode.l10n.t('Completed');
        case 'current':
            return vscode.l10n.t('Current');
        default:
            return vscode.l10n.t('Not started');
    }
}

function toStageIconName(stageId: string): string {
    if (stageId.includes('projectCreation')) {
        return 'new-file';
    }

    if (stageId.includes('localDevelopment')) {
        return 'terminal';
    }

    return 'rocket';
}
