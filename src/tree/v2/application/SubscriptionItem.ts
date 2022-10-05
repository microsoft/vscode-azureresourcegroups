/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ApplicationResourceProviderManager } from "../../../api/v2/ResourceProviderManagers";
import { ApplicationSubscription } from "../../../api/v2/v2AzureResourcesApi";
import { isPinned } from "../../../commands/explorer/pinning";
import { treeUtils } from "../../../utils/treeUtils";
import { ResourceGroupsItem } from "../ResourceGroupsItem";
import { ResourceGroupsTreeContext } from "../ResourceGroupsTreeContext";
import { ApplicationResourceGroupingManager } from "./ApplicationResourceGroupingManager";
import { GroupingItem } from "./GroupingItem";

export class SubscriptionItem implements ResourceGroupsItem {
    constructor(
        private readonly context: ResourceGroupsTreeContext,
        private readonly resourceGroupingManager: ApplicationResourceGroupingManager,
        private readonly resourceProviderManager: ApplicationResourceProviderManager,
        private readonly subscription: ApplicationSubscription) {
    }

    async getChildren(): Promise<ResourceGroupsItem[]> {
        const resources = await this.resourceProviderManager.getResources(this.subscription);

        return this.resourceGroupingManager.groupResources(this.context, resources ?? []).sort(compareGroupTreeItems);
    }

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.subscription.displayName ?? 'Unnamed', vscode.TreeItemCollapsibleState.Collapsed);

        treeItem.contextValue = 'azureextensionui.azureSubscription';
        treeItem.iconPath = treeUtils.getIconPath('azureSubscription');
        treeItem.id = this.subscription.subscriptionId;

        return treeItem;
    }

    id: string;
    name: string;
    type: string;
}

function compareGroupTreeItems(a: GroupingItem, b: GroupingItem): number {
    const aIsPinned = isPinned(a);
    const bIsPinned = isPinned(b);

    if (aIsPinned && !bIsPinned) {
        // A is pinned and B is not pinned, so A should come first
        return -1;
    } else if (!aIsPinned && bIsPinned) {
        // A is not pinned and B is pinned, so B should come first
        return 1;
    } else {
        // A and B are both pinned or both unpinned, compare by label alone
        return a.label.localeCompare(b.label);
    }
}
