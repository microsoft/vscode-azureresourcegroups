/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { Identity } from "@azure/arm-msi";
import { TargetServiceRoleAssignmentItem } from '@microsoft/vscode-azext-azureutils';
import { callWithTelemetryAndErrorHandling, createContextValue, createSubscriptionContext, nonNullProp, type IActionContext } from "@microsoft/vscode-azext-utils";
import { type AzureResource, type AzureSubscription, type ViewPropertiesModel } from "@microsoft/vscode-azureresources-api";
import { TreeItem, TreeItemCollapsibleState } from "vscode";
import { getAzureResourcesService } from "../services/AzureResourcesService";
import { ResourceGroupsItem } from "../tree/ResourceGroupsItem";
import { createManagedServiceIdentityClient } from "../utils/azureClients";
import { getIconPath } from "../utils/azureUtils";
import { SourceResourceIdentityItem } from "./SourceResourceIdentityItem";

export class ManagedIdentityItem implements ResourceGroupsItem {
    static readonly contextValue: string = 'managedIdentityItem';
    static readonly contextValueRegExp: RegExp = new RegExp(ManagedIdentityItem.contextValue);
    name: string;
    id: string;

    constructor(public readonly subscription: AzureSubscription,
        public readonly resource: AzureResource) {
        this.id = resource.id;
        this.name = resource.name;
    }

    viewProperties: ViewPropertiesModel = {
        data: this.resource,
        label: this.resource.name,
    }

    private get contextValue(): string {
        const values: string[] = [];
        values.push(ManagedIdentityItem.contextValue);
        return createContextValue(values);
    }

    async getChildren<TreeElementBase>(): Promise<TreeElementBase[]> {
        const result = await callWithTelemetryAndErrorHandling('managedIdentityItem.getChildren', async (context: IActionContext) => {
            const subContext = createSubscriptionContext(this.subscription);
            const msiClient = await createManagedServiceIdentityClient([context, subContext]);
            const msi: Identity = await msiClient.userAssignedIdentities.get(nonNullProp(this.resource, 'resourceGroup'), this.resource.name);

            const resources = await getAzureResourcesService().listResources(context, this.subscription);
            const sourceResourceItem = new SourceResourceIdentityItem(this.subscription, msi, resources);
            const targetServiceItem = await TargetServiceRoleAssignmentItem.createTargetServiceRoleAssignmentItem(context, this.subscription, msi);

            const children = [];

            if (sourceResourceItem.getChildren().length > 0) {
                // if there weren't any assigned resources, don't show that section
                children.push(sourceResourceItem);
            }


            children.push(targetServiceItem);
            return children;
        });

        return result ?? [];
    }

    getTreeItem(): TreeItem {
        return {
            label: this.resource.name,
            id: this.id,
            iconPath: getIconPath(this.resource.resourceType),
            contextValue: this.contextValue,
            collapsibleState: TreeItemCollapsibleState.Collapsed,
        }
    }
}


