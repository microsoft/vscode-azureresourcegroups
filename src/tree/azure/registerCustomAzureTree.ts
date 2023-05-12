/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { AzureResource } from '../../../api/src/index';
import { AzureResourceProviderManager } from '../../api/ResourceProviderManagers';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { createTreeView } from '../createTreeView';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { TreeItemStateStore } from '../TreeItemState';
import { wrapTreeForVSCode } from '../wrapTreeForVSCode';
import { AzureResourceBranchDataProviderManager } from './AzureResourceBranchDataProviderManager';
import { AzureResourceGroupingManager } from './AzureResourceGroupingManager';
import { createResourceItemFactory } from './AzureResourceItem';
import { CustomAzureResourceTreeDataProvider } from './CustomAzureResourceTreeDataProvider';
import { createGroupingItemFactory } from './GroupingItem';

interface RegisterAzureTreeOptions {
    azureResourceBranchDataProviderManager: AzureResourceBranchDataProviderManager,
    azureResourceProviderManager: AzureResourceProviderManager,
    refreshEvent: vscode.Event<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>,
    itemCache: BranchDataItemCache,
}

export function registerMyResourcesTree(context: vscode.ExtensionContext, options: RegisterAzureTreeOptions): CustomAzureResourceTreeDataProvider {
    const { azureResourceBranchDataProviderManager, azureResourceProviderManager: resourceProviderManager, refreshEvent, itemCache } = options;

    context.subscriptions.push(ext.azureTreeState = new TreeItemStateStore());

    const resourceGroupingManager = createGroupingManager(azureResourceBranchDataProviderManager, itemCache);
    context.subscriptions.push(resourceGroupingManager);

    const azureResourceTreeDataProvider =
        new CustomAzureResourceTreeDataProvider(
            azureResourceBranchDataProviderManager.onDidChangeTreeData,
            itemCache,
            ext.azureTreeState,
            refreshEvent,
            resourceGroupingManager,
            resourceProviderManager,
        );

    context.subscriptions.push(azureResourceTreeDataProvider);

    const treeView = createTreeView('azureResourcesView;azureFavorites', {
        canSelectMany: true,
        showCollapseAll: true,
        itemCache,
        title: localize('favoriteResources', 'Focused Resources'),
        treeDataProvider: wrapTreeForVSCode(azureResourceTreeDataProvider, itemCache),
        findItemById: azureResourceTreeDataProvider.findItemById.bind(azureResourceTreeDataProvider) as typeof azureResourceTreeDataProvider.findItemById,
    });
    context.subscriptions.push(treeView);
    ext.favoritesView = treeView as unknown as vscode.TreeView<AzExtTreeItem>;

    return azureResourceTreeDataProvider;
}

function createGroupingManager(azureResourceBranchDataProviderManager: AzureResourceBranchDataProviderManager, itemCache: BranchDataItemCache): AzureResourceGroupingManager {
    const branchDataItemFactory = createResourceItemFactory<AzureResource>(itemCache);
    const groupingItemFactory = createGroupingItemFactory(branchDataItemFactory, (r) => azureResourceBranchDataProviderManager.getProvider(r.resourceType), azureResourceBranchDataProviderManager.onChangeBranchDataProviders, {
        expandByDefault: true,
        hideSeparators: false,
    });
    return new AzureResourceGroupingManager(groupingItemFactory);
}
