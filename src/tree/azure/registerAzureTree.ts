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
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { TreeItemStateStore } from '../TreeItemState';
import { createTreeView } from '../createTreeView';
import { wrapTreeForVSCode } from '../wrapTreeForVSCode';
import { AzureResourceBranchDataProviderManager } from './AzureResourceBranchDataProviderManager';
import { createResourceItemFactory } from './AzureResourceItem';
import { AzureResourceTreeDataProvider } from './AzureResourceTreeDataProvider';
import { AzureResourceGroupingManager } from './grouping/AzureResourceGroupingManager';
import { GroupingItemFactory } from './grouping/GroupingItemFactory';

interface RegisterAzureTreeOptions {
    azureResourceBranchDataProviderManager: AzureResourceBranchDataProviderManager,
    azureResourceProviderManager: AzureResourceProviderManager,
    refreshEvent: vscode.Event<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>,
    itemCache: BranchDataItemCache,
}

export function registerAzureTree(context: vscode.ExtensionContext, options: RegisterAzureTreeOptions): AzureResourceTreeDataProvider {
    const { azureResourceBranchDataProviderManager, azureResourceProviderManager: resourceProviderManager, refreshEvent, itemCache } = options;

    context.subscriptions.push(ext.azureTreeState = new TreeItemStateStore());

    const resourceGroupingManager = createGroupingManager(azureResourceBranchDataProviderManager, itemCache);
    context.subscriptions.push(resourceGroupingManager);
    const azureResourceTreeDataProvider =
        new AzureResourceTreeDataProvider(azureResourceBranchDataProviderManager.onDidChangeTreeData, itemCache, ext.azureTreeState, refreshEvent, resourceGroupingManager, resourceProviderManager);
    context.subscriptions.push(azureResourceTreeDataProvider);

    const treeView = createTreeView('azureResourceGroups', {
        canSelectMany: true,
        showCollapseAll: true,
        itemCache,
        description: localize('remote', 'Remote'),
        title: localize('resources', 'Resources'),
        treeDataProvider: wrapTreeForVSCode(azureResourceTreeDataProvider, itemCache),
        findItemById: azureResourceTreeDataProvider.findItemById.bind(azureResourceTreeDataProvider) as typeof azureResourceTreeDataProvider.findItemById,
    });
    context.subscriptions.push(treeView);
    ext.appResourceTreeView = treeView as unknown as vscode.TreeView<AzExtTreeItem>;

    return azureResourceTreeDataProvider;
}

function createGroupingManager(azureResourceBranchDataProviderManager: AzureResourceBranchDataProviderManager, itemCache: BranchDataItemCache): AzureResourceGroupingManager {
    const branchDataItemFactory = createResourceItemFactory<AzureResource>(itemCache);
    const groupingItemFactory = new GroupingItemFactory({
        resourceItemFactory: branchDataItemFactory,
        branchDataProviderFactory: (r) => azureResourceBranchDataProviderManager.getProvider(r.resourceType),
        onDidChangeBranchDataProviders: azureResourceBranchDataProviderManager.onChangeBranchDataProviders,
        defaultDisplayOptions: {
            expandByDefault: false,
            hideSeparators: true,
        }
    });
    return new AzureResourceGroupingManager(groupingItemFactory);
}
