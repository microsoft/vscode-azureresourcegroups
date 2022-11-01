/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ApplicationResourceProviderManager } from '../../../api/v2/ResourceProviderManagers';
import { ext } from '../../../extensionVariables';
import { createBranchDataItemFactory } from '../BranchDataProviderItem';
import { createTreeView } from '../createTreeView';
import { ResourceGroupsItemCache } from '../ResourceGroupsItemCache';
import { localize } from './../../../utils/localize';
import { ApplicationResourceBranchDataProviderManager } from './ApplicationResourceBranchDataProviderManager';
import { ApplicationResourceGroupingManager } from './ApplicationResourceGroupingManager';
import { ApplicationResourceTreeDataProvider } from './ApplicationResourceTreeDataProvider';
import { createGroupingItemFactory } from './GroupingItem';

interface RegisterApplicationTreeOptions {
    branchDataProviderManager: ApplicationResourceBranchDataProviderManager,
    refreshEvent: vscode.Event<void>,
    applicationResourceProviderManager: ApplicationResourceProviderManager
}

interface RegisterApplicationTreeResult {
    applicationResourceTreeDataProvider: ApplicationResourceTreeDataProvider;
}

export function registerApplicationTree(context: vscode.ExtensionContext, options: RegisterApplicationTreeOptions): RegisterApplicationTreeResult {
    const { branchDataProviderManager, applicationResourceProviderManager: resourceProviderManager, refreshEvent } = options;

    const itemCache = new ResourceGroupsItemCache();
    const branchDataItemFactory = createBranchDataItemFactory(itemCache);
    const groupingItemFactory = createGroupingItemFactory(branchDataItemFactory, resource => branchDataProviderManager.getProvider(resource.resourceType));
    const resourceGroupingManager = new ApplicationResourceGroupingManager(groupingItemFactory);

    context.subscriptions.push(resourceGroupingManager);

    const applicationResourceTreeDataProvider = new ApplicationResourceTreeDataProvider(
        branchDataProviderManager.onDidChangeTreeData,
        itemCache, refreshEvent,
        resourceGroupingManager,
        resourceProviderManager);

    context.subscriptions.push(applicationResourceTreeDataProvider);

    ext.v2.applicationResourceTree = applicationResourceTreeDataProvider;

    const treeView = createTreeView('azureResourceGroups', {
        treeDataProvider: applicationResourceTreeDataProvider,
        canSelectMany: true,
        showCollapseAll: true,
        description: localize('remote', 'Remote'),
    });

    context.subscriptions.push(treeView);

    ext.appResourceTreeView = treeView as unknown as vscode.TreeView<AzExtTreeItem>;
    ext.v2.applicationResourceTreeView = treeView;

    return {
        applicationResourceTreeDataProvider
    }
}
