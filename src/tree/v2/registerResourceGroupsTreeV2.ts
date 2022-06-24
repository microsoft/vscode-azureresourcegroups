import * as vscode from 'vscode';
import { ApplicationResourceProviderManager } from '../../api/v2/providers/ApplicationResourceProviderManager';
import { ApplicationResourceGroupingManager } from './ApplicationResourceGroupingManager';
import { createBranchDataItemFactory } from './BranchDataItem';
import { createGroupingItemFactory } from './GroupingItem';
import { BranchDataProviderManager } from './providers/BranchDataProviderManager';
import { ResourceGroupItemCache } from './ResourceGroupItemCache';
import { ResourceGroupsTreeDataProvider } from './ResourceGroupsTreeDataProvider';

export function registerResourceGroupsTreeV2(
    context: vscode.ExtensionContext,
    branchDataProviderManager: BranchDataProviderManager,
    resourceProviderManager: ApplicationResourceProviderManager): void {
    const itemCache = new ResourceGroupItemCache();
    const branchDataItemFactory = createBranchDataItemFactory(itemCache);
    const groupingItemFactory = createGroupingItemFactory(branchDataItemFactory, resource => branchDataProviderManager.getApplicationResourceBranchDataProvider(resource));
    const resourceGroupingManager = new ApplicationResourceGroupingManager(groupingItemFactory);

    context.subscriptions.push(resourceGroupingManager);

    const treeDataProvider = new ResourceGroupsTreeDataProvider(itemCache, branchDataProviderManager.onDidChangeTreeData, resourceGroupingManager, resourceProviderManager);

    context.subscriptions.push(treeDataProvider);

    context.subscriptions.push(vscode.window.registerTreeDataProvider('azureResourceGroupsV2', treeDataProvider));
}
