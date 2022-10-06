/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ApplicationResourceProviderManager } from '../../../api/v2/ResourceProviderManagers';
import { ext } from '../../../extensionVariables';
import { createApplicationResourceBranchDataItemFactory } from '../ApplicationResourceBranchDataItem';
import { ResourceGroupsItemCache } from '../ResourceGroupsItemCache';
import { localize } from './../../../utils/localize';
import { ApplicationResourceBranchDataProviderManager } from './ApplicationResourceBranchDataProviderManager';
import { ApplicationResourceGroupingManager } from './ApplicationResourceGroupingManager';
import { ApplicationResourceTreeDataProvider } from './ApplicationResourceTreeDataProvider';
import { createGroupingItemFactory } from './GroupingItem';

export function registerResourceGroupsTreeV2(
    context: vscode.ExtensionContext,
    branchDataProviderManager: ApplicationResourceBranchDataProviderManager,
    refreshEvent: vscode.Event<void>,
    resourceProviderManager: ApplicationResourceProviderManager): void {
    const itemCache = new ResourceGroupsItemCache();
    const branchDataItemFactory = createApplicationResourceBranchDataItemFactory(itemCache);
    const groupingItemFactory = createGroupingItemFactory(branchDataItemFactory, resource => branchDataProviderManager.getProvider(resource.azExtResourceType ?? resource.type.type));
    const resourceGroupingManager = new ApplicationResourceGroupingManager(groupingItemFactory);

    context.subscriptions.push(resourceGroupingManager);

    const treeDataProvider = new ApplicationResourceTreeDataProvider(branchDataProviderManager.onDidChangeTreeData, itemCache, refreshEvent, resourceGroupingManager, resourceProviderManager);
    ext.v2.resourceGroupsTreeDataProvider = treeDataProvider;

    context.subscriptions.push(treeDataProvider);

    const treeView = vscode.window.createTreeView(
        'azureResourceGroupsV2',
        {
            canSelectMany: true,
            showCollapseAll: true,
            treeDataProvider
        });

    treeView.description = localize('remote', 'Remote');

    context.subscriptions.push(treeView);
}
