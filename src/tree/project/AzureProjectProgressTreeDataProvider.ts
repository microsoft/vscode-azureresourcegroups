/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getDebugConfigurations, getProjectPlanFiles } from './projectPlanFiles';

type ProgressState = 'completed' | 'current' | 'notStarted';

const notStartedDecorationScheme = 'azure-project-progress-notstarted';

class NotStartedDecorationProvider implements vscode.FileDecorationProvider {
    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (uri.scheme !== notStartedDecorationScheme) {
            return undefined;
        }
        return {
            color: new vscode.ThemeColor('disabledForeground'),
        };
    }
}

interface StageNode {
    readonly kind: 'stage';
    readonly id: string;
    readonly label: string;
    readonly stepNumber: number;
    readonly state: ProgressState;
    readonly hasPlanFile: boolean;
    readonly openPlanCommandId: string;
    readonly startCommandId: string;
    readonly stageKind: 'projectCreation' | 'localDevelopment' | 'deployment';
}

interface ActionNode {
    readonly kind: 'action';
    readonly id: string;
    readonly label: string;
    readonly description?: string;
    readonly iconName: string;
    readonly commandId?: string;
    readonly commandArguments?: unknown[];
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

        this.disposables.push(vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('launch')) {
                this.refresh();
            }
        }));

        this.disposables.push(vscode.window.registerFileDecorationProvider(new NotStartedDecorationProvider()));

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
                element.state === 'current'
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.Collapsed,
            );
            item.id = `${element.id}.${element.state}`;
            item.description = toStageDescription(element.state, element.hasPlanFile);
            item.tooltip = new vscode.MarkdownString(`**${element.label}** — ${toStateText(element.state)}`);
            item.iconPath = toStageIcon(element.state, element.id);
            if (element.state === 'notStarted') {
                item.resourceUri = vscode.Uri.from({ scheme: notStartedDecorationScheme, path: `/${element.id}` });
            }
            return item;
        }

        const actionItem = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        actionItem.id = element.id;
        actionItem.iconPath = new vscode.ThemeIcon(element.iconName);
        actionItem.tooltip = element.description ?? element.label;

        if (element.commandId) {
            actionItem.command = {
                command: element.commandId,
                title: '',
                arguments: element.commandArguments,
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
                stageKind: 'projectCreation',
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
                stageKind: 'localDevelopment',
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
                stageKind: 'deployment',
            },
        ];
    }

    private getActionNodes(stage: StageNode): ActionNode[] {
        const actions: ActionNode[] = [];

        const debugConfigs = stage.stageKind === 'localDevelopment' && stage.hasPlanFile
            ? getDebugConfigurations()
            : [];

        if (stage.hasPlanFile && debugConfigs.length === 0) {
            actions.push({
                kind: 'action',
                id: `${stage.id}.openPlan`,
                label: vscode.l10n.t('Open plan'),
                iconName: 'preview',
                commandId: stage.openPlanCommandId,
            });
        }

        if (!stage.hasPlanFile) {
            actions.push({
                kind: 'action',
                id: `${stage.id}.start`,
                label: vscode.l10n.t('Start'),
                iconName: 'play-circle',
                commandId: stage.startCommandId,
            });
        }

        for (const config of debugConfigs) {
            actions.push({
                kind: 'action',
                id: `${stage.id}.debug.${config.folder.uri.toString()}.${config.name}`,
                label: vscode.l10n.t('Debug: {0}', config.name),
                description: vscode.l10n.t('Start debugging "{0}"', config.name),
                iconName: 'debug-alt',
                commandId: 'workbench.action.debug.selectandstart',
                commandArguments: [config.name],
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

function toStageIcon(state: ProgressState, stageId: string): vscode.ThemeIcon {
    switch (state) {
        case 'completed':
            return new vscode.ThemeIcon('pass-filled');
        case 'current':
            return new vscode.ThemeIcon(toStageIconName(stageId));
        default:
            return new vscode.ThemeIcon(toStageIconName(stageId), new vscode.ThemeColor('disabledForeground'));
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
