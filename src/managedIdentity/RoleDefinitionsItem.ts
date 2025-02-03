/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { RoleDefinition } from "@azure/arm-authorization";
import { parseAzureResourceGroupId, parseAzureResourceId, ParsedAzureResourceGroupId, ParsedAzureResourceId } from "@microsoft/vscode-azext-azureutils";
import { TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { AzureSubscription } from "api/src";
import { TreeItem, TreeItemCollapsibleState, Uri } from "vscode";
import { AzExtResourceType } from "../../api/src/AzExtResourceType";
import { getAzExtResourceType } from "../../api/src/getAzExtResourceType";
import { ext } from "../extensionVariables";
import { GenericItem } from "../tree/GenericItem";
import { ResourceGroupsItem } from "../tree/ResourceGroupsItem";
import { getIconPath } from "../utils/azureUtils";
import { createPortalUrl } from "../utils/v2/createPortalUrl";

export class RoleDefinitionsItem implements ResourceGroupsItem {
    public id: string;
    public label: string;
    public iconPath: TreeItemIconPath;
    public description: string | undefined;
    public roleDefintions: RoleDefinition[] = [];
    public readonly portalUrl: Uri;

    constructor(options: {
        label: string,
        id: string,
        iconPath: TreeItemIconPath,
        description: string | undefined,
        roleDefinition: RoleDefinition,
        subscription: AzureSubscription,
        scope: string
    }) {
        this.label = options.label;
        this.id = options.id;
        this.iconPath = options.iconPath;
        this.roleDefintions.push(options.roleDefinition);
        this.description = options.description;
        this.portalUrl = createPortalUrl(options.subscription, options.scope);
    }

    public static async createRoleDefinitionsItem(scope: string,
        roleDefinition: RoleDefinition,
        msiId: string | undefined,
        subscription: AzureSubscription,
        fromOtherSub?: boolean): Promise<RoleDefinitionsItem> {

        let parsedAzureResourceId: ParsedAzureResourceId | undefined;
        let parsedAzureResourceGroupId: ParsedAzureResourceGroupId | undefined;
        let label: string;
        let iconPath: TreeItemIconPath;
        let description: string | undefined;

        try {
            parsedAzureResourceId = parseAzureResourceId(scope);
            label = parsedAzureResourceId.resourceName;
            iconPath = getIconPath(getAzExtResourceType({ type: parsedAzureResourceId.provider }));
        }
        catch (error) {
            try {
                // if it's not a resource, then it's possibly a resource group or subscription
                parsedAzureResourceGroupId = parseAzureResourceGroupId(scope);
                label = parsedAzureResourceGroupId.resourceGroup;
                iconPath = getIconPath(AzExtResourceType.ResourceGroup);
            } catch (error) {
                // if it's not a resource group, then it's a subscription
                const subscriptions = await (await ext.subscriptionProviderFactory()).getSubscriptions(false);
                const subscriptionId = scope.split('/').pop();
                label = subscriptions.find(s => s.subscriptionId === subscriptionId)?.name ?? scope;
                iconPath = getIconPath(AzExtResourceType.Subscription);
            }
        }

        if (fromOtherSub) {
            // retrieve subscriptions to use display name if it's from another subscription
            const subscriptions = await (await ext.subscriptionProviderFactory()).getSubscriptions(false);
            description = subscriptions.find(s => s.subscriptionId === (parsedAzureResourceGroupId?.subscriptionId ?? parsedAzureResourceId?.subscriptionId))?.name;
        }

        return new RoleDefinitionsItem({
            id: `${msiId}/${scope}`,
            label,
            iconPath,
            description,
            roleDefinition,
            subscription,
            scope
        });
    }

    getTreeItem(): TreeItem {
        return {
            label: this.label,
            id: this.id,
            iconPath: this.iconPath,
            description: this.description,
            collapsibleState: TreeItemCollapsibleState.Collapsed,
        }
    }

    getChildren(): ResourceGroupsItem[] {
        return this.roleDefintions.map((rd) => {
            return new GenericItem("", { id: `${this.id}/${rd.id}`, description: rd.roleName, tooltip: rd.description });
        });
    }

    addRoleDefinition(roleDefinition: RoleDefinition): void {
        if (!this.roleDefintions.some((rd) => rd.roleName === roleDefinition.roleName)) {
            this.roleDefintions.push(roleDefinition);
        }
    }
}
