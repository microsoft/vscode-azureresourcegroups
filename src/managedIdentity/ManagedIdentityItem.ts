/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { Identity } from "@azure/arm-msi";
import { uiUtils } from "@microsoft/vscode-azext-azureutils";
import { callWithTelemetryAndErrorHandling, createContextValue, createSubscriptionContext, nonNullProp, type IActionContext } from "@microsoft/vscode-azext-utils";
import { type AzureResource, type AzureSubscription, type ViewPropertiesModel } from "@microsoft/vscode-azureresources-api";
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { getAzExtResourceType } from "../../api/src/index";
import { getAzureResourcesService } from "../services/AzureResourcesService";
import { GenericItem } from "../tree/GenericItem";
import { ResourceGroupsItem } from "../tree/ResourceGroupsItem";
import { createAuthorizationManagementClient, createManagedServiceIdentityClient } from "../utils/azureClients";
import { getIconPath } from "../utils/azureUtils";
import { localize } from "../utils/localize";
import { RoleAssignmentsItem } from "./RoleAssignmentsItem";
import { RoleDefinitionsItem } from "./RoleDefinitionsItem";

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

    async getChildren(): Promise<(GenericItem | RoleDefinitionsItem | RoleAssignmentsItem)[]> {
        const result = await callWithTelemetryAndErrorHandling('managedIdentityItem.getChildren', async (context: IActionContext) => {
            const subContext = createSubscriptionContext(this.subscription);
            const msiClient = await createManagedServiceIdentityClient([context, subContext]);
            const msi: Identity = await msiClient.userAssignedIdentities.get(nonNullProp(this.resource, 'resourceGroup'), this.resource.name);

            const resources = await getAzureResourcesService().listResources(context, this.subscription);
            const assignedRoleAssignment = new RoleAssignmentsItem(localize('sourceResources', 'Source resources'), this.subscription, msi);
            const accessRoleAssignment = new RoleAssignmentsItem(localize('targetServices', 'Target services'), this.subscription, msi);

            const assignedResources = resources.filter((r) => {
                // verify the msi is assigned to the resource by checking if the msi id is in the userAssignedIdentities
                const userAssignedIdentities = r.identity?.userAssignedIdentities;
                if (!userAssignedIdentities) {
                    return false;
                }

                if (!msi.id) {
                    return false;
                }

                return userAssignedIdentities[msi.id] !== undefined
            }).map((r) => {
                return new GenericItem(nonNullProp(r, 'name'), { id: `${msi.id}/${r.name}`, iconPath: getIconPath(r.type ? getAzExtResourceType({ type: r.type }) : undefined) });
            });

            const authClient = await createAuthorizationManagementClient([context, subContext]);
            const roleAssignment = await uiUtils.listAllIterator(authClient.roleAssignments.listForSubscription());
            // filter the role assignments to only show the ones that are assigned to the msi
            const filteredBySub = roleAssignment.filter((ra) => ra.principalId === msi.principalId);

            const targetResources = await accessRoleAssignment.getRoleDefinitionsItems(context, filteredBySub);
            const children = [];

            if (assignedResources.length > 0) {
                // if there weren't any assigned resources, don't show that section
                assignedRoleAssignment.addChildren(assignedResources);
                children.push(assignedRoleAssignment);
            }

            accessRoleAssignment.addChildren(targetResources);
            children.push(accessRoleAssignment);
            accessRoleAssignment.addChild(new GenericItem(localize('showResources', 'Show resources from other subscriptions...'),
                {
                    id: accessRoleAssignment.id + '/showResourcesFromOtherSubscriptions',
                    iconPath: new ThemeIcon('sync'),
                    commandId: 'azureResources.loadAllSubscriptionRoleAssignments',
                    commandArgs: [accessRoleAssignment]
                }))
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


