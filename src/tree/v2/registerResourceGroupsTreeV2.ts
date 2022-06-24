import * as vscode from 'vscode';
import { ApplicationResourceProviderManager } from '../../api/v2/providers/ApplicationResourceProviderManager';
import { ApplicationResourceGroupingManager } from './ApplicationResourceGroupingManager';
import { BranchDataProviderManager } from './providers/BranchDataProviderManager';
import { ResourceGroupItemCache } from './ResourceGroupItemCache';
import { ResourceGroupsTreeDataProvider } from './ResourceGroupsTreeDataProvider';

export function registerResourceGroupsTreeV2(
    context: vscode.ExtensionContext,
    branchDataProviderManager: BranchDataProviderManager,
    resourceProviderManager: ApplicationResourceProviderManager): void {
    const resourceGroupingManager = new ApplicationResourceGroupingManager(resource => branchDataProviderManager.getApplicationResourceBranchDataProvider(resource))

    context.subscriptions.push(resourceGroupingManager);

    const itemCache = new ResourceGroupItemCache();
    const treeDataProvider = new ResourceGroupsTreeDataProvider(itemCache, branchDataProviderManager.onDidChangeTreeData, resourceGroupingManager, resourceProviderManager);

    context.subscriptions.push(treeDataProvider);

    context.subscriptions.push(vscode.window.registerTreeDataProvider('azureResourceGroupsV2', treeDataProvider));
}
