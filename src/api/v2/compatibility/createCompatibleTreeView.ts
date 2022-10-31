/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, isAzExtTreeItem } from "@microsoft/vscode-azext-utils";
import { TreeView } from "vscode";
import { ResourceGroupsItem } from "../../../tree/v2/ResourceGroupsItem";
import { ResourceTreeDataProviderBase } from "../../../tree/v2/ResourceTreeDataProviderBase";

export interface InternalTreeView extends TreeView<ResourceGroupsItem> {
    _reveal: TreeView<ResourceGroupsItem>['reveal'];
}

/**
 * Creates a TreeView for compatibility with v1.5 extensions.
 * - Modify `reveal` to handle AzExtTreeItems
 */
export function createCompatibleTreeView(treeView: TreeView<ResourceGroupsItem>, treeDataProvider: ResourceTreeDataProviderBase): TreeView<AzExtTreeItem> {
    (treeView as InternalTreeView)._reveal = treeView.reveal.bind(treeView) as typeof treeView.reveal;

    treeView.reveal = async (element, options) => {
        const item: ResourceGroupsItem | undefined = isAzExtTreeItem(element) ? await treeDataProvider.findItem(element.fullId) : element;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await treeDataProvider.reveal(treeView as InternalTreeView, item!, options);
    }

    return treeView as unknown as TreeView<AzExtTreeItem>;
}
