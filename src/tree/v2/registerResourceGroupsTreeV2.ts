import * as vscode from 'vscode';
import { ApplicationResourceProviderManager } from '../../api/v2/providers/ApplicationResourceProviderManager';
import { ResourceGroupsTreeDataProvider } from './ResourceGroupsTreeDataProvider';

export function registerResourceGroupsTreeV2(context: vscode.ExtensionContext, resourceProviderManager: ApplicationResourceProviderManager): void {
    const treeDataProvider = new ResourceGroupsTreeDataProvider(resourceProviderManager);

    context.subscriptions.push(vscode.window.registerTreeDataProvider('azureResourceGroupsV2', treeDataProvider));
}
