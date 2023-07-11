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
import { createTreeView } from '../createTreeView';
import { wrapTreeForVSCode } from '../wrapTreeForVSCode';
import { AzureResourceBranchDataProviderManager } from './AzureResourceBranchDataProviderManager';
import { createResourceItemFactory } from './AzureResourceItem';
import { FocusViewTreeDataProvider } from './FocusViewTreeDataProvider';
import { AzureResourceGroupingManager } from './grouping/AzureResourceGroupingManager';
import { GroupingItemFactory } from './grouping/GroupingItemFactory';

interface RegisterAzureTreeOptions {
    azureResourceBranchDataProviderManager: AzureResourceBranchDataProviderManager,
    azureResourceProviderManager: AzureResourceProviderManager,
    refreshEvent: vscode.Event<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>,
    itemCache: BranchDataItemCache,
}

export function registerFocusTree(context: vscode.ExtensionContext, options: RegisterAzureTreeOptions): FocusViewTreeDataProvider {
    const { azureResourceBranchDataProviderManager, azureResourceProviderManager: resourceProviderManager, refreshEvent, itemCache } = options;

    const resourceGroupingManager = createGroupingManager(azureResourceBranchDataProviderManager, itemCache);
    context.subscriptions.push(resourceGroupingManager);

    const focusViewTreeDataProvider =
        new FocusViewTreeDataProvider(
            azureResourceBranchDataProviderManager.onDidChangeTreeData,
            itemCache,
            ext.azureTreeState,
            refreshEvent,
            resourceGroupingManager,
            resourceProviderManager,
        );

    context.subscriptions.push(focusViewTreeDataProvider);

    const treeView = createTreeView('azureFocusView', {
        canSelectMany: false,
        showCollapseAll: false,
        itemCache,
        title: localize('focusedResources', 'Focused Resources'),
        treeDataProvider: wrapTreeForVSCode(focusViewTreeDataProvider, itemCache),
        findItemById: focusViewTreeDataProvider.findItemById.bind(focusViewTreeDataProvider) as typeof focusViewTreeDataProvider.findItemById,
    });
    context.subscriptions.push(treeView);
    ext.focusView = treeView as unknown as vscode.TreeView<AzExtTreeItem>;

    return focusViewTreeDataProvider;
}

function createGroupingManager(azureResourceBranchDataProviderManager: AzureResourceBranchDataProviderManager, itemCache: BranchDataItemCache): AzureResourceGroupingManager {
    const branchDataItemFactory = createResourceItemFactory<AzureResource>(itemCache);
    const groupingItemFactory = new GroupingItemFactory({
        resourceItemFactory: branchDataItemFactory,
        branchDataProviderFactory: (r) => azureResourceBranchDataProviderManager.getProvider(r.resourceType),
        onDidChangeBranchDataProviders: azureResourceBranchDataProviderManager.onChangeBranchDataProviders,
        defaultDisplayOptions: {
            expandByDefault: true,
            hideSeparators: false,
        }
    });
    return new AzureResourceGroupingManager(groupingItemFactory);
}
