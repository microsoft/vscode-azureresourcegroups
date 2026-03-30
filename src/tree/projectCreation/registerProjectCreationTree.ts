/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerCommand } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { showProjectCreationContextKey } from '../../constants';
import { ProjectCreationTreeDataProvider } from './ProjectCreationTreeDataProvider';
import { ResourceGroupsItem } from '../ResourceGroupsItem';

const planFileName = 'project-plan.md';
const planFileDir = '.azure';

export function registerProjectCreationTree(context: vscode.ExtensionContext): ProjectCreationTreeDataProvider {
    const treeDataProvider = new ProjectCreationTreeDataProvider();

    const treeView = vscode.window.createTreeView('azureProjectCreation', {
        treeDataProvider,
        showCollapseAll: true,
    });

    treeView.description = 'Plan \u2192 Develop \u2192 Deploy';

    // Auto-show the view if .azure/project-plan.md exists at startup
    void checkPlanFileStatus();

    // Watch for .azure/project-plan.md being created, deleted, or changed
    const planWatcher = vscode.workspace.createFileSystemWatcher(`**/${planFileDir}/${planFileName}`);
    context.subscriptions.push(planWatcher);
    planWatcher.onDidCreate(() => void checkPlanFileStatus());
    planWatcher.onDidChange(() => void checkPlanFileStatus());
    planWatcher.onDidDelete(() => void hideView());

    async function checkPlanFileStatus(): Promise<void> {
        const files = await vscode.workspace.findFiles(`${planFileDir}/${planFileName}`, null, 1);
        if (files.length === 0) { return; }

        await vscode.commands.executeCommand('setContext', showProjectCreationContextKey, true);

        const content = await vscode.workspace.fs.readFile(files[0]);
        const text = Buffer.from(content).toString('utf-8');

        // "Define Plan" is complete only when the plan is approved or scaffolded
        if (/\*\*Status\*\*:\s*(Approved|Scaffolded)/i.test(text)) {
            treeDataProvider.completeStep('projectCreation/plan/definePlan');
        } else {
            treeDataProvider.uncompleteStep('projectCreation/plan/definePlan');
        }

        // Check if the plan indicates scaffolding is done
        if (/\*\*Status\*\*:\s*Scaffolded/i.test(text)) {
            treeDataProvider.completeStep('projectCreation/plan/scaffold');
        } else {
            treeDataProvider.uncompleteStep('projectCreation/plan/scaffold');
        }
    }

    async function hideView(): Promise<void> {
        await vscode.commands.executeCommand('setContext', showProjectCreationContextKey, false);
    }

    registerCommand('azureProjectCreation.show', async () => {
        await vscode.commands.executeCommand('setContext', showProjectCreationContextKey, true);

        // Open the Azure sidebar to ensure the view container is visible
        await vscode.commands.executeCommand('workbench.view.extension.azure');

        // Wait for the view to become visible after the context change
        if (!treeView.visible) {
            await new Promise<void>((resolve) => {
                const disposable = treeView.onDidChangeVisibility((e) => {
                    if (e.visible) {
                        disposable.dispose();
                        resolve();
                    }
                });
                // Fallback timeout to avoid hanging indefinitely
                setTimeout(() => {
                    disposable.dispose();
                    resolve();
                }, 2000);
            });
        }
    });

    registerCommand('azureProjectCreation.hide', async () => {
        await vscode.commands.executeCommand('setContext', showProjectCreationContextKey, false);
    });

    registerCommand('azureProjectCreation.focus', async (_context, nodeIds?: string[]) => {
        if (nodeIds?.length) {
            // Reveal and expand the specified nodes
            for (const id of nodeIds) {
                const item = treeDataProvider.findItemById(id);
                if (item) {
                    await revealWithRetry(treeView, item, { focus: true, select: false, expand: true });
                }
            }
        } else {
            // Default: focus the first phase
            const firstPhase = treeDataProvider.getFirstPhase();
            if (firstPhase) {
                await revealWithRetry(treeView, firstPhase, { focus: true, select: false, expand: false });
            }
        }
    });

    registerCommand('azureProjectCreation.openPlan', async () => {
        await vscode.commands.executeCommand('containerApps.openPlanViewFromWorkspace');
    });

    registerCommand('azureProjectCreation.setupLocalDev', async () => {
        await vscode.commands.executeCommand('workbench.action.chat.newChat');
        await vscode.commands.executeCommand('workbench.action.chat.open', { query: '/azure-localdev' });
    });

    registerCommand('azureProjectCreation.completeStep', async (_context, stepId?: string) => {
        if (stepId) {
            treeDataProvider.completeStep(stepId);
        }
    });

    context.subscriptions.push(treeView);

    return treeDataProvider;
}

async function revealWithRetry(
    treeView: vscode.TreeView<ResourceGroupsItem>,
    item: ResourceGroupsItem,
    options: { focus: boolean; select: boolean; expand: boolean },
    retries = 3,
): Promise<void> {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            await treeView.reveal(item, options);
            return;
        } catch {
            if (attempt < retries - 1) {
                // Tree may not be fully rendered yet, wait before retrying
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
    }
}
