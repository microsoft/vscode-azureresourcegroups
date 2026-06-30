/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DeploymentStageItem } from './DeploymentStageItem';
import { LocalDevelopmentStageItem } from './LocalDevelopmentStageItem';
import { ProgressNode } from './ProgressNode';
import { ProjectCreationStageItem } from './ProjectCreationStageItem';
import { getProjectPlanFiles, type ProjectPlanFilesWatcher } from './projectPlanFiles';
import { projectSubmissionState } from './projectSubmissionState';
import { notStartedDecorationScheme, StageNode } from './StageNode';

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

export class AzureProjectProgressTreeDataProvider implements vscode.TreeDataProvider<ProgressNode>, vscode.Disposable {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ProgressNode | undefined | void>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    private readonly disposables: vscode.Disposable[] = [];

    constructor(context: vscode.ExtensionContext, planFilesWatcher: ProjectPlanFilesWatcher) {
        this.disposables.push(planFilesWatcher.onDidChange(() => this.refresh()));
        this.disposables.push(projectSubmissionState.onDidChange(() => this.refresh()));

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
        return element.getTreeItem();
    }

    async getChildren(element?: ProgressNode): Promise<ProgressNode[]> {
        if (!element) {
            return this.getStageNodes();
        }

        return element.getChildren();
    }

    private async getStageNodes(): Promise<StageNode[]> {
        const files = await getProjectPlanFiles();

        if (!files.hasAny && !projectSubmissionState.isPending) {
            return [];
        }

        // If the user has started a stage via the chat agent but the plan file
        // hasn't been written yet, use the pending stage so the tree reflects progress.
        const effectiveStage = projectSubmissionState.isPending
            ? Math.max(files.currentStage, projectSubmissionState.pendingStage) as typeof files.currentStage
            : files.currentStage;

        return [
            new ProjectCreationStageItem(effectiveStage, files.hasProjectPlan),
            new LocalDevelopmentStageItem(effectiveStage, files.hasLocalDevelopmentPlan),
            new DeploymentStageItem(effectiveStage, files.hasDeploymentPlan),
        ];
    }
}
