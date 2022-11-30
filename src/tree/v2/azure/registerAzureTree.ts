/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AzureResourceProviderManager } from '../../../api/v2/ResourceProviderManagers';
import { AzureResource } from '../../../api/v2/v2AzureResourcesApi';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { localize } from './../../../utils/localize';
import { AzureResourceBranchDataProviderManager } from './AzureResourceBranchDataProviderManager';
import { AzureResourceGroupingManager } from './AzureResourceGroupingManager';
import { createResourceItemFactory } from './AzureResourceItem';
import { AzureResourceTreeDataProvider } from './AzureResourceTreeDataProvider';
import { createGroupingItemFactory } from './GroupingItem';

interface RegisterApplicationTreeOptions {
    azureResourceBranchDataProviderManager: AzureResourceBranchDataProviderManager,
    azureResourceProviderManager: AzureResourceProviderManager,
    refreshEvent: vscode.Event<void>,
}

export function registerAzureTree(context: vscode.ExtensionContext, options: RegisterApplicationTreeOptions): void {
    const { azureResourceBranchDataProviderManager, azureResourceProviderManager: resourceProviderManager, refreshEvent } = options;

    const itemCache = new BranchDataItemCache();
    const branchDataItemFactory = createResourceItemFactory<AzureResource>(itemCache);
    const groupingItemFactory = createGroupingItemFactory(branchDataItemFactory, resource => azureResourceBranchDataProviderManager.getProvider(resource.resourceType));

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
}
