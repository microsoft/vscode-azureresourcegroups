/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { isAzExtTreeItem } from "@microsoft/vscode-azext-utils";
import { TreeDataProvider, TreeView, TreeViewOptions, window } from "vscode";
import { BranchDataItemCache } from "./BranchDataItemCache";
import { TreeDataItem } from "./ResourceGroupsItem";

export interface InternalTreeView extends TreeView<TreeDataItem> {
    _reveal: TreeView<TreeDataItem>['reveal'];
}

interface InternalTreeViewOptions extends TreeViewOptions<TreeDataItem> {
    treeDataProvider: TreeDataProvider<TreeDataItem>;
    findItemById: (id: string) => Promise<TreeDataItem | undefined>;
    itemCache: BranchDataItemCache;
    /**
     * See {@link TreeView.description}
     */
    description?: string;
    /**
     * See {@link TreeView.title}
     */
    title?: string;
}

/**
 * Wrapper for `window.createTreeView`
 * - sets the `description` if present in options
 * - modifies `TreeView.reveal` {@link ResourceTreeDataProviderBase.reveal}
 */
export function createTreeView(viewId: string, options: InternalTreeViewOptions): TreeView<TreeDataItem> {
    const treeView = window.createTreeView(viewId, options);
    treeView.title = options.title;
    treeView.description = options.description;

    modifyReveal(treeView, options.findItemById, options.itemCache);

    return treeView;
}

/**
 * v1.5 compatibility for TreeView.reveal
 */
function modifyReveal(treeView: TreeView<TreeDataItem>, findItemById: (id: string) => Promise<TreeDataItem | undefined>, itemCache: BranchDataItemCache): void {
    (treeView as InternalTreeView)._reveal = treeView.reveal.bind(treeView) as typeof treeView.reveal;

    treeView.reveal = async (element, options) => {
        // For compatibility: convert AzExtTreeItems into TreeDataItems
        const item: TreeDataItem | undefined = isAzExtTreeItem(element) ? itemCache.getItemForBranchItem(element) ?? await findItemById(element.fullId) : element;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await (treeView as InternalTreeView)._reveal(item!, options);
    };
}
