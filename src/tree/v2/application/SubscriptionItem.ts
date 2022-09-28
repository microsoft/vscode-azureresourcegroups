/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ApplicationSubscription } from "../../../api/v2/v2AzureResourcesApi";
import { treeUtils } from "../../../utils/treeUtils";
import { ApplicationResourceGroupingManager } from "./ApplicationResourceGroupingManager";
import { ResourceGroupsItem } from "../ResourceGroupsItem";
import { ResourceGroupsTreeContext } from "../ResourceGroupsTreeContext";
import { ApplicationResourceProviderManager } from "../../../api/v2/ResourceproviderManagerBase";

export class SubscriptionItem implements ResourceGroupsItem {
    constructor(
        private readonly context: ResourceGroupsTreeContext,
        private readonly resourceGroupingManager: ApplicationResourceGroupingManager,
        private readonly resourceProviderManager: ApplicationResourceProviderManager,
        private readonly subscription: ApplicationSubscription) {
    }

    async getChildren(): Promise<ResourceGroupsItem[]> {
        const resources = await this.resourceProviderManager.getResources(this.subscription);

        return this.resourceGroupingManager.groupResources(this.context, resources ?? []).sort((a, b) => a.label.localeCompare(b.label));
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
