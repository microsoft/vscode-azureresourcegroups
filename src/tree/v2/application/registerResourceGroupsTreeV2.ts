/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ApplicationResourceProviderManager } from '../../../api/v2/ApplicationResourceProviderManager';
import { localize } from './../../../utils/localize';
import { ApplicationResourceGroupingManager } from './ApplicationResourceGroupingManager';
import { createBranchDataItemFactory } from '../BranchDataProviderItem';
import { createGroupingItemFactory } from './GroupingItem';
import { ApplicationResourceBranchDataProviderManager } from './ApplicationResourceBranchDataProviderManager';
import { ResourceGroupsItemCache } from '../ResourceGroupsItemCache';
import { ResourceGroupsTreeDataProvider } from './ResourceGroupsTreeDataProvider';

export function registerResourceGroupsTreeV2(
    context: vscode.ExtensionContext,
    branchDataProviderManager: ApplicationResourceBranchDataProviderManager,
    refreshEvent: vscode.Event<void>,
    resourceProviderManager: ApplicationResourceProviderManager): void {
    const itemCache = new ResourceGroupsItemCache();
    const branchDataItemFactory = createBranchDataItemFactory(itemCache);
    const groupingItemFactory = createGroupingItemFactory(branchDataItemFactory, resource => branchDataProviderManager.getProvider(resource.type.type));
    const resourceGroupingManager = new ApplicationResourceGroupingManager(groupingItemFactory);

    context.subscriptions.push(resourceGroupingManager);

    const treeDataProvider = new ResourceGroupsTreeDataProvider(branchDataProviderManager.onDidChangeTreeData, itemCache, refreshEvent, resourceGroupingManager, resourceProviderManager);

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
