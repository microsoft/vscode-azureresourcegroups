/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import type { Event, ProviderResult, TreeDataProvider, TreeItem } from "vscode";
import { BranchDataItemCache } from "./BranchDataItemCache";
import { TreeDataItem } from "./ResourceGroupsItem";
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
class OnRefreshTreeDataProvider implements TreeDataProvider<TreeDataItem> {
    constructor(
        private readonly treeDataProvider: TreeDataProvider<TreeDataItem>,
        private readonly onRefresh: () => void,
    ) { }

    getTreeItem(element: TreeDataItem): TreeItem | Thenable<TreeItem> {
        return this.treeDataProvider.getTreeItem(element);
    }

    getParent(element: TreeDataItem): ProviderResult<TreeDataItem> {
        return this.treeDataProvider.getParent?.(element);
    }

    getChildren(element?: TreeDataItem): ProviderResult<TreeDataItem[]> {
        if (!element) {
            this.onRefresh();
        }
        return this.treeDataProvider.getChildren(element);
    }

    onDidChangeTreeData?: Event<void | TreeDataItem | TreeDataItem[] | null | TreeDataItem> = this.treeDataProvider.onDidChangeTreeData;
}
