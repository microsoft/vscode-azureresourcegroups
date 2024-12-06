/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, createSubscriptionContext, IActionContext, ISubscriptionContext, nonNullValueAndProp } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { AzureSubscription } from "../../../api/src/index";
import { AzureResourceProviderManager } from "../../api/ResourceProviderManagers";
import { settingUtils } from "../../utils/settingUtils";
import { treeUtils } from "../../utils/treeUtils";
import { createPortalUrl } from "../../utils/v2/createPortalUrl";
import { ResourceGroupsItem } from "../ResourceGroupsItem";
import { ResourceGroupsTreeContext } from "../ResourceGroupsTreeContext";
import { AzureResourceGroupingManager } from "./grouping/AzureResourceGroupingManager";

export class SubscriptionItem implements ResourceGroupsItem {
    constructor(
        private readonly context: ResourceGroupsTreeContext,
        private readonly resourceGroupingManager: AzureResourceGroupingManager,
        private readonly resourceProviderManager: AzureResourceProviderManager,
        subscription: AzureSubscription,
        description?: string) {

        this.subscription = {
            // for v1.5 compatibility
            ...createSubscriptionContext(subscription),
            ...subscription
        };

        this.id = `/accounts/${nonNullValueAndProp(subscription.account, 'id')}/tenants/${subscription.tenantId}/subscriptions/${subscription.subscriptionId}`;
        this.description = description ? description : '';

        this.portalUrl = createPortalUrl(this.subscription, `/subscriptions/${this.subscription.subscriptionId}`);
    }

    public readonly portalUrl: vscode.Uri;

    public readonly id: string;
    private description?: string;
    public readonly subscription: ISubscriptionContext & AzureSubscription;

    async getChildren(): Promise<ResourceGroupsItem[]> {
        return await callWithTelemetryAndErrorHandling('subscriptionItem.getChildren', async (context: IActionContext) => {
            const resources = await this.resourceProviderManager.getResources(this.subscription);
            context.telemetry.measurements.resourceCount = resources.length;

            const groupBySetting = settingUtils.getWorkspaceSetting<string>('groupBy');
            context.telemetry.properties.groupBySetting = groupBySetting?.startsWith('armTag') ? 'armTag' : groupBySetting;

            const groupingItems = this.resourceGroupingManager.groupResources(this, this.context, resources ?? [], groupBySetting).sort((a, b) => a.label.localeCompare(b.label));
            context.telemetry.measurements.groupCount = groupingItems.length;

            return groupingItems;
        }) ?? [];
    }

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.subscription.name ?? 'Unnamed', vscode.TreeItemCollapsibleState.Collapsed);

        treeItem.contextValue = 'azureextensionui.azureSubscription';
        treeItem.iconPath = treeUtils.getIconPath('azureSubscription');
        treeItem.description = this.description;
        treeItem.id = this.id;

        return treeItem;
    }
}
