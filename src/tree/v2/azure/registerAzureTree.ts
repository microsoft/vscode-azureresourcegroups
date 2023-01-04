/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem } from '@microsoft/vscode-azext-utils';
import { AzureResource } from '@microsoft/vscode-azext-utils/hostapi.v2';
import * as vscode from 'vscode';
import { AzureResourceProviderManager } from '../../../api/v2/ResourceProviderManagers';
import { ext } from '../../../extensionVariables';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { localize } from './../../../utils/localize';
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
    const groupingItemFactory = createGroupingItemFactory(branchDataItemFactory, resource => azureResourceBranchDataProviderManager.getProvider(resource.resourceType), azureResourceBranchDataProviderManager.onChangeBranchDataProviders.bind(azureResourceBranchDataProviderManager));

    const resourceGroupingManager = new AzureResourceGroupingManager(groupingItemFactory);
    context.subscriptions.push(resourceGroupingManager);

    const azureResourceTreeDataProvider =
        new AzureResourceTreeDataProvider(azureResourceBranchDataProviderManager.onDidChangeTreeData, itemCache, refreshEvent, resourceGroupingManager, resourceProviderManager);
    context.subscriptions.push(azureResourceTreeDataProvider);

    const treeView = vscode.window.createTreeView('azureResourceGroups', {
        canSelectMany: true,
        showCollapseAll: true,
        treeDataProvider: azureResourceTreeDataProvider,
    });
    context.subscriptions.push(treeView);

    treeView.description = localize('remote', 'Remote');

    ext.appResourceTreeView = treeView as unknown as vscode.TreeView<AzExtTreeItem>;

    return azureResourceTreeDataProvider;
}
