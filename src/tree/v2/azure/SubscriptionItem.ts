/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtResourceType } from "@microsoft/vscode-azext-utils";
import { AzureSubscription } from "@microsoft/vscode-azext-utils/hostapi.v2";
import * as vscode from "vscode";
import { AzureResourceProviderManager } from "../../../api/v2/ResourceProviderManagers";
import { azureExtensions } from "../../../azureExtensions";
import { isPinned } from "../../../commands/explorer/pinning";
import { showHiddenTypesSettingKey } from "../../../constants";
import { settingUtils } from "../../../utils/settingUtils";
import { treeUtils } from "../../../utils/treeUtils";
import { ResourceGroupsItem } from "../ResourceGroupsItem";
import { ResourceGroupsTreeContext } from "../ResourceGroupsTreeContext";
import { AzureResourceGroupingManager } from "./AzureResourceGroupingManager";
import { GroupingItem } from "./GroupingItem";

const supportedResourceTypes: AzExtResourceType[] =
    azureExtensions
        .map(e => e.resourceTypes)
        .reduce((a, b) => a.concat(...b), []);

export class SubscriptionItem implements ResourceGroupsItem {
    constructor(
        private readonly context: ResourceGroupsTreeContext,
        private readonly resourceGroupingManager: AzureResourceGroupingManager,
        private readonly resourceProviderManager: AzureResourceProviderManager,
        public readonly subscription: AzureSubscription) {
    }

    public readonly id: string = `/subscriptions/${this.subscription.subscriptionId}`;

    async getChildren(): Promise<ResourceGroupsItem[]> {
        let resources = await this.resourceProviderManager.getResources(this.subscription);

        const showHiddenTypes = settingUtils.getWorkspaceSetting<boolean>(showHiddenTypesSettingKey);

        if (!showHiddenTypes) {
            resources = resources.filter(resource => resource.azureResourceType.type === 'microsoft.resources/resourcegroups' || (resource.resourceType && supportedResourceTypes.find(type => type === resource.resourceType)));
        }

        return this.resourceGroupingManager.groupResources(this, this.context, resources ?? []).sort(compareGroupTreeItems);
    }

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.subscription.name ?? 'Unnamed', vscode.TreeItemCollapsibleState.Collapsed);

        treeItem.contextValue = 'azureextensionui.azureSubscription';
        treeItem.iconPath = treeUtils.getIconPath('azureSubscription');
        treeItem.id = this.id;

        return treeItem;
    }
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
