/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AuthorizationManagementClient } from "@azure/arm-authorization";
import { Identity, ManagedServiceIdentityClient } from "@azure/arm-msi";
import { uiUtils } from "@microsoft/vscode-azext-azureutils";
import { callWithTelemetryAndErrorHandling, createContextValue, createSubscriptionContext, nonNullProp, type IActionContext } from "@microsoft/vscode-azext-utils";
import { ResourceBase, type AzureResource, type AzureSubscription, type ViewPropertiesModel } from "@microsoft/vscode-azureresources-api";
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { getAzExtResourceType } from "../../api/src/index";
import { getAzureResourcesService } from "../services/AzureResourcesService";
import { GenericItem } from "../tree/GenericItem";
import { getIconPath } from "../utils/azureUtils";
import { RoleAssignmentsItem } from "./RoleAssignmentsItem";

export class ManagedIdentityItem implements ResourceBase {
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

    async getChildren(): Promise<RoleAssignmentsItem[]> {
        const result = await callWithTelemetryAndErrorHandling('managedIdentityItem.getChildren', async (context: IActionContext) => {
            const subContext = createSubscriptionContext(this.subscription);
            const msiClient = new ManagedServiceIdentityClient(subContext.credentials, subContext.subscriptionId);
            const msi: Identity = await msiClient.userAssignedIdentities.get(nonNullProp(this.resource, 'resourceGroup'), this.resource.name);

            const resources = await getAzureResourcesService().listResources(context, this.subscription);

            const assignedRoleAssignment = new RoleAssignmentsItem('Assigned to', this.subscription, msi);
            const accessRoleAssignment = new RoleAssignmentsItem('Grants access to', this.subscription, msi);

            const assignedResources = resources.filter((r) => {
                const userAssignedIdentities = r.identity?.userAssignedIdentities;
                if (!userAssignedIdentities) {
                    return false;
                }

                if (!msi.id) {
                    return false;
                }

                return userAssignedIdentities[msi.id] !== undefined
            }).map((r) => {
                return new GenericItem(nonNullProp(r, 'name'), { iconPath: getIconPath(r.type ? getAzExtResourceType({ type: r.type }) : undefined) });
            });

            const authClient = new AuthorizationManagementClient(subContext.credentials, subContext.subscriptionId);

            const roleAssignment = await uiUtils.listAllIterator(authClient.roleAssignments.listForSubscription());
            const filteredBySub = roleAssignment.filter((ra) => ra.principalId === msi.principalId);

            const targetResources = await accessRoleAssignment.getRoleDefinitionsItems(filteredBySub);
            assignedRoleAssignment.addChildren(assignedResources);
            accessRoleAssignment.addChildren(targetResources);
            accessRoleAssignment.addChild(new GenericItem('Show resources from other subscriptions...',
                {
                    iconPath: new ThemeIcon('sync'),
                    commandId: 'azureResources.loadAllSubscriptionRoleAssignments',
                    commandArgs: [accessRoleAssignment]
                }))

            const children = [];

            if ((await assignedRoleAssignment.getChildren()).length > 0) {
                // if there weren't any assigned resources, don't show that section
                children.push(assignedRoleAssignment);
            }

            children.push(accessRoleAssignment);
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


