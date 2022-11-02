/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { isAzExtTreeItem } from "@microsoft/vscode-azext-utils";
import { TreeView, TreeViewOptions, window } from "vscode";
import { ResourceGroupsItem } from "./ResourceGroupsItem";
import { ResourceGroupsItemCache } from "./ResourceGroupsItemCache";
import { ResourceTreeDataProviderBase } from "./ResourceTreeDataProviderBase";

export interface InternalTreeView extends TreeView<ResourceGroupsItem> {
    _reveal: TreeView<ResourceGroupsItem>['reveal'];
}

interface InternalTreeViewOptions extends TreeViewOptions<ResourceGroupsItem> {
    treeDataProvider: ResourceTreeDataProviderBase;
    itemCache: ResourceGroupsItemCache;
    /**
     * See {@link TreeView.description}
     */
    description?: string;
}

/**
 * Wrapper for `window.createTreeView`
 * - sets the `description` if present in options
 * - modifies `TreeView.reveal` {@link ResourceTreeDataProviderBase.reveal}
 */
export function createTreeView(viewId: string, options: InternalTreeViewOptions): TreeView<ResourceGroupsItem> {
    const treeView = window.createTreeView(viewId, options);
    treeView.description = options.description;

    modifyReveal(treeView, options.treeDataProvider, options.itemCache);

    return treeView;
}

function modifyReveal(treeView: TreeView<ResourceGroupsItem>, treeDataProvider: ResourceTreeDataProviderBase, itemCache: ResourceGroupsItemCache): void {
    (treeView as InternalTreeView)._reveal = treeView.reveal.bind(treeView) as typeof treeView.reveal;

    treeView.reveal = async (element, options) => {
        // For compatibility: convert AzExtTreeItems into ResourceGroupsItems
        const item: ResourceGroupsItem | undefined = isAzExtTreeItem(element) ? itemCache.getItemForBranchItem(element) ?? await treeDataProvider.findItem(element.fullId) : element;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await treeDataProvider.reveal(treeView as InternalTreeView, item!, options);
    }
}
