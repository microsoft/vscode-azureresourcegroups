import * as vscode from 'vscode';
import { WorkspaceTreeDataProvider } from './WorkspaceTreeDataProvider';

export function registerResourceGroupsTreeV2(
    context: vscode.ExtensionContext): void {
    const treeDataProvider = new WorkspaceTreeDataProvider();

    context.subscriptions.push(vscode.window.registerTreeDataProvider('azureWorkspaceV2', treeDataProvider));
}
