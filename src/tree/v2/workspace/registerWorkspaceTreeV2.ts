import * as vscode from 'vscode';
import { WorkspaceResourceProviderManager } from '../../../api/v2/providers/WorkspaceResourceProviderManager';
import { WorkspaceResourceBranchDataProviderManager } from './WorkspaceResourceBranchDataProviderManager';
import { WorkspaceTreeDataProvider } from './WorkspaceTreeDataProvider';
import { localize } from './../../../utils/localize';

export function registerWorkspaceTreeV2(
    branchDataProviderManager: WorkspaceResourceBranchDataProviderManager,
    context: vscode.ExtensionContext,
    refreshEvent: vscode.Event<void>,
    workspaceResourceProviderManager: WorkspaceResourceProviderManager): void {
    const treeDataProvider = new WorkspaceTreeDataProvider(
        branchDataProviderManager,
        refreshEvent,
        workspaceResourceProviderManager);

    context.subscriptions.push(treeDataProvider);

    const treeView = vscode.window.createTreeView(
        'azureWorkspaceV2',
        {
            canSelectMany: true,
            treeDataProvider
        });

    treeView.description = localize('local', 'Local');

    context.subscriptions.push(treeView);
}
