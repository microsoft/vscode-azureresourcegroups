/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtResourceType } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { ApplicationResourceProviderManager } from "../../../api/v2/ResourceProviderManagers";
import { ApplicationSubscription } from "../../../api/v2/v2AzureResourcesApi";
import { azureExtensions } from "../../../azureExtensions";
import { showHiddenTypesSettingKey } from "../../../constants";
import { settingUtils } from "../../../utils/settingUtils";
import { treeUtils } from "../../../utils/treeUtils";
import { ResourceGroupsItem } from "../ResourceGroupsItem";
import { ResourceGroupsTreeContext } from "../ResourceGroupsTreeContext";
import { ApplicationResourceGroupingManager } from "./ApplicationResourceGroupingManager";

const supportedResourceTypes: AzExtResourceType[] =
    azureExtensions
        .map(e => e.resourceTypes)
        .reduce((a, b) => a.concat(...b), []);

export class SubscriptionItem implements ResourceGroupsItem {
    constructor(
        private readonly context: ResourceGroupsTreeContext,
        private readonly resourceGroupingManager: ApplicationResourceGroupingManager,
        private readonly resourceProviderManager: ApplicationResourceProviderManager,
        private readonly subscription: ApplicationSubscription) {
    }

    public readonly id: string = this.subscription.subscriptionId;

    async getChildren(): Promise<ResourceGroupsItem[]> {
        let resources = await this.resourceProviderManager.getResources(this.subscription);

        const showHiddenTypes = settingUtils.getWorkspaceSetting<boolean>(showHiddenTypesSettingKey);

        if (!showHiddenTypes) {
            resources = resources.filter(resource => resource.azureResourceType.type === 'microsoft.resources/resourcegroups' || (resource.resourceType && supportedResourceTypes.find(type => type === resource.resourceType)));
        }

        return this.resourceGroupingManager.groupResources(this.context, resources ?? []).sort((a, b) => a.label.localeCompare(b.label));
    }

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.subscription.name ?? 'Unnamed', vscode.TreeItemCollapsibleState.Collapsed);

        treeItem.contextValue = 'azureextensionui.azureSubscription';
        treeItem.iconPath = treeUtils.getIconPath('azureSubscription');
        treeItem.id = this.subscription.subscriptionId;

        return treeItem;
    }

    getParent(): vscode.ProviderResult<ResourceGroupsItem> {
        return undefined;
    }
}
