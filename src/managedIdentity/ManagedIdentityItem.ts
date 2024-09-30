/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AuthorizationManagementClient } from "@azure/arm-authorization";
import { Identity, ManagedServiceIdentityClient } from "@azure/arm-msi";
import { GenericResource } from "@azure/arm-resources";
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

    resources: GenericResource[] = [];

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

            this.resources = await getAzureResourcesService().listResources(context, this.subscription);

            const assignedResources = new RoleAssignmentsItem('Assigned to', this.subscription, msi);
            const targetResources = new RoleAssignmentsItem('Gives access to', this.subscription, msi);

            const theseResourcesNode = this.resources.filter((r) => {
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

            const hasAccessToNodes = await targetResources.getRoleDefinitionsItems(filteredBySub);
            assignedResources.addChildren(theseResourcesNode);
            targetResources.addChildren(hasAccessToNodes);
            targetResources.addChild(new GenericItem('Show resources from other subscriptions...',
                {
                    iconPath: new ThemeIcon('sync'),
                    commandId: 'azureResources.loadAllSubscriptionRoleAssignments',
                    commandArgs: [targetResources]
                }))

            const children = [assignedResources, targetResources];
            if ((await assignedResources.getChildren()).length === 0) {
                children.splice(0, 1);
            }

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


