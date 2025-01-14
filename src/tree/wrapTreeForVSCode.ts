/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import type { Event, ProviderResult, TreeDataProvider, TreeItem } from "vscode";
import { ext } from "../extensionVariables";
import { BranchDataItemCache } from "./BranchDataItemCache";
import { ResourceGroupsItem } from "./ResourceGroupsItem";
import { ResourceTreeDataProviderBase } from "./ResourceTreeDataProviderBase";

/**
 * Returns a new tree data provider that clears the branch item cache when the root of the tree is refreshed.
 */
export function wrapTreeForVSCode(treeDataProvider: ResourceTreeDataProviderBase, branchItemCache: BranchDataItemCache): OnRefreshTreeDataProvider {
    return new OnRefreshTreeDataProvider(treeDataProvider, () => branchItemCache.clear());
}

/**
 * Wraps a tree data provider and calls a callback function when the root of the tree is refreshed.
 */
class OnRefreshTreeDataProvider implements TreeDataProvider<ResourceGroupsItem> {
    constructor(
        private readonly treeDataProvider: TreeDataProvider<ResourceGroupsItem>,
        private readonly onRefresh: () => void,
    ) { }

    getTreeItem(element: ResourceGroupsItem): TreeItem | Thenable<TreeItem> {
        return this.treeDataProvider.getTreeItem(element);
    }

    getParent(element: ResourceGroupsItem): ProviderResult<ResourceGroupsItem> {
        return this.treeDataProvider.getParent?.(element);
    }

    getChildren(element?: ResourceGroupsItem): ProviderResult<ResourceGroupsItem[]> {
        if (!element) {
            this.onRefresh();
            // when refreshing the root of the tree, we need to ensure that the managed identity branch data provider is re-initialized
            void ext.managedIdentityBranchDataProvider.initialize();
        }
        return this.treeDataProvider.getChildren(element);
    }

    onDidChangeTreeData?: Event<void | ResourceGroupsItem | ResourceGroupsItem[] | null | ResourceGroupsItem> = this.treeDataProvider.onDidChangeTreeData;
}
