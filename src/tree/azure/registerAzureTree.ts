/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem } from '@microsoft/vscode-azext-utils';
import { AzureResource } from '@microsoft/vscode-azext-utils/hostapi.v2';
import * as vscode from 'vscode';
import { AzureResourceProviderManager } from '../../api/ResourceProviderManagers';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { createTreeView } from '../createTreeView';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { wrapTreeForVSCode } from '../wrapTreeForVSCode';
import { AzureResourceBranchDataProviderManager } from './AzureResourceBranchDataProviderManager';
import { AzureResourceGroupingManager } from './AzureResourceGroupingManager';
import { createResourceItemFactory } from './AzureResourceItem';
import { AzureResourceTreeDataProvider } from './AzureResourceTreeDataProvider';
import { createGroupingItemFactory } from './GroupingItem';

interface RegisterAzureTreeOptions {
    azureResourceBranchDataProviderManager: AzureResourceBranchDataProviderManager,
    azureResourceProviderManager: AzureResourceProviderManager,
    refreshEvent: vscode.Event<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>,
}

export function registerAzureTree(context: vscode.ExtensionContext, options: RegisterAzureTreeOptions): AzureResourceTreeDataProvider {
    const { azureResourceBranchDataProviderManager, azureResourceProviderManager: resourceProviderManager, refreshEvent } = options;

    const itemCache = new BranchDataItemCache();
    const branchDataItemFactory = createResourceItemFactory<AzureResource>(itemCache);
    const groupingItemFactory = createGroupingItemFactory(branchDataItemFactory, resource => azureResourceBranchDataProviderManager.getProvider(resource.resourceType), azureResourceBranchDataProviderManager.onChangeBranchDataProviders);

    const resourceGroupingManager = new AzureResourceGroupingManager(groupingItemFactory);
    context.subscriptions.push(resourceGroupingManager);

    const azureResourceTreeDataProvider =
        new AzureResourceTreeDataProvider(azureResourceBranchDataProviderManager.onDidChangeTreeData, itemCache, refreshEvent, resourceGroupingManager, resourceProviderManager);
    context.subscriptions.push(azureResourceTreeDataProvider);

    const treeView = createTreeView('azureResourceGroups', {
        canSelectMany: true,
        showCollapseAll: true,
        itemCache,
        description: localize('remote', 'Remote'),
        treeDataProvider: wrapTreeForVSCode(azureResourceTreeDataProvider, itemCache),
        findItemById: azureResourceTreeDataProvider.findItemById.bind(azureResourceTreeDataProvider) as typeof azureResourceTreeDataProvider.findItemById
    });
    context.subscriptions.push(treeView);

    ext.appResourceTreeView = treeView as unknown as vscode.TreeView<AzExtTreeItem>;

    return azureResourceTreeDataProvider;
}
