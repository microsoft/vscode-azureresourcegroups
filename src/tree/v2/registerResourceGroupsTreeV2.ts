import * as vscode from 'vscode';
import { ResourceGroupsTreeDataProvider } from './ResourceGroupsTreeDataProvider';

export function registerResourceGroupsTreeV2(context: vscode.ExtensionContext): void {
    const treeDataProvider = new ResourceGroupsTreeDataProvider();

    context.subscriptions.push(vscode.window.registerTreeDataProvider('azureResourceGroupsV2', treeDataProvider));
}
