import * as vscode from 'vscode';
import { WorkspaceResourceProviderManager } from '../../../api/v2/providers/WorkspaceResourceProviderManager';
import { WorkspaceResourceBranchDataProviderManager } from './WorkspaceResourceBranchDataProviderManager';
import { WorkspaceTreeDataProvider } from './WorkspaceTreeDataProvider';

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

    context.subscriptions.push(vscode.window.registerTreeDataProvider('azureWorkspaceV2', treeDataProvider));
}
