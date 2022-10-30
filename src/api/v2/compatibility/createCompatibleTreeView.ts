/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, isAzExtTreeItem, ResourceGroupsItem } from "@microsoft/vscode-azext-utils";
import { TreeView } from "vscode";
import { ResourceTreeDataProviderBase } from "../../../tree/v2/ResourceTreeDataProviderBase";

interface InternalTreeView extends TreeView<ResourceGroupsItem> {
    _reveal: TreeView<ResourceGroupsItem>['reveal'];
}

/**
 * Creates a TreeView for compatibility with v1.5 extensions.
 * - Modify `reveal` to handle AzExtTreeItems
 */
export function createCompatibleTreeView(treeView: TreeView<ResourceGroupsItem>, treeDataProvider: ResourceTreeDataProviderBase): TreeView<AzExtTreeItem> {
    (treeView as InternalTreeView)._reveal = treeView.reveal.bind(treeView) as typeof treeView.reveal;

    treeView.reveal = async (element, options) => {
        await treeDataProvider.runWithGate(async () => {
            console.log('reveal started');
            // convert AzExtTreeItem into BranchDataProviderItem that VS Code knows how to reveal
            const item = isAzExtTreeItem(element) ? await treeDataProvider.findItem((element as AzExtTreeItem).fullId) : element;
            await (treeView as InternalTreeView)._reveal(item, options);
            console.log('reveal finished');
        });
    }

    return treeView as TreeView<AzExtTreeItem>;
}
