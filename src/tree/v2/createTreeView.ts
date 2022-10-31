/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { isAzExtTreeItem } from "@microsoft/vscode-azext-utils";
import { TreeView, TreeViewOptions, window } from "vscode";
import { ResourceGroupsItem } from "./ResourceGroupsItem";
import { ResourceTreeDataProviderBase } from "./ResourceTreeDataProviderBase";

export interface InternalTreeView extends TreeView<ResourceGroupsItem> {
    _reveal: TreeView<ResourceGroupsItem>['reveal'];
}

interface InternalTreeViewOptions extends TreeViewOptions<ResourceGroupsItem> {
    treeDataProvider: ResourceTreeDataProviderBase;
    description?: string;
}

export function createTreeView(viewId: string, options: InternalTreeViewOptions): TreeView<ResourceGroupsItem> {
    const treeView = window.createTreeView(viewId, options);
    wrapReveal(treeView, options.treeDataProvider);

    treeView.description = options.description;

    return treeView;
}

/**
 * Modify `TreeView.reveal` so that it:
 * - Handles `AzExtTreeItem`s *(for v1.5 compatibility)*
 * - Calls `ResourceTreeDataProviderBase.reveal` instead of directly calling `TreeView.reveal`
 */
function wrapReveal(treeView: TreeView<ResourceGroupsItem>, treeDataProvider: ResourceTreeDataProviderBase): void {
    (treeView as InternalTreeView)._reveal = treeView.reveal.bind(treeView) as typeof treeView.reveal;

    treeView.reveal = async (element, options) => {
        const item: ResourceGroupsItem | undefined = isAzExtTreeItem(element) ? await treeDataProvider.findItem(element.fullId) : element;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await treeDataProvider.reveal(treeView as InternalTreeView, item!, options);
    }
}
