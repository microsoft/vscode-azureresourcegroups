/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AuthorizationManagementClient, RoleAssignment } from "@azure/arm-authorization";
import { Identity } from "@azure/arm-msi";
import { createSubscriptionContext } from "@microsoft/vscode-azext-utils";
import { TreeItem, TreeItemCollapsibleState } from "vscode";
import { AzureSubscription, getAzExtResourceType } from "../../api/src";
import { ext } from "../extensionVariables";
import { GenericItem } from "../tree/GenericItem";
import { ResourceGroupsItem } from "../tree/ResourceGroupsItem";
import { getIconPath } from "../utils/azureUtils";
import { RoleDefinitionsItem } from "./RoleDefinitionsItem";

export class RoleAssignmentsItem implements ResourceGroupsItem {
    public id: string;
    public label: string;
    private children: (RoleDefinitionsItem | GenericItem)[] = [];

    constructor(label: string, readonly subscription: AzureSubscription, readonly msi: Identity) {
        this.label = label;
        this.id = `${msi.id}/${label}`;
    }

    getTreeItem(): TreeItem {
        return {
            description: this.label,
            id: this.id,
            collapsibleState: TreeItemCollapsibleState.Collapsed,
        }
    }

    async getChildren(): Promise<(RoleDefinitionsItem | GenericItem)[]> {
        return this.children;
    }

    addChild(child: RoleDefinitionsItem | GenericItem): void {
        this.children.push(child);
    }

    addChildren(children: (RoleDefinitionsItem | GenericItem)[]): void {
        this.children.push(...children);
    }

    removeLastChild(): void {
        this.children.pop();
    }

    async getRoleDefinitionsItems(roleAssignments: RoleAssignment[], fromOtherSubs?: boolean): Promise<RoleDefinitionsItem[]> {
        const subContext = createSubscriptionContext(this.subscription);
        const authClient = new AuthorizationManagementClient(subContext.credentials, subContext.subscriptionId);
        const roleDefinitionsItems: RoleDefinitionsItem[] = [];
        // retrieve subscriptions to use display name
        const subscriptions = fromOtherSubs ? await (await ext.subscriptionProviderFactory()).getSubscriptions(false) : [];
        await Promise.all(roleAssignments
            .map(async (ra) => {
                if (!ra.scope || !ra.roleDefinitionId) {
                    return;
                }

                // sample value "/subscriptions/<subscription-id>/resourceGroups/<resourceGroup-name>/providers/Microsoft.Web/sites/<resource-name>"
                const scopeSplit = ra.scope.split('/');
                const name = scopeSplit.pop();
                const resourceType = scopeSplit.pop();
                const provider = scopeSplit.pop();

                if (provider && resourceType && name && (!fromOtherSubs || !ra.scope?.includes(this.subscription.subscriptionId))) {
                    const roleDefinition = await authClient.roleDefinitions.getById(ra.roleDefinitionId);
                    if (!roleDefinitionsItems.some((rdi) => rdi.label === name)) {
                        const rdi = new RoleDefinitionsItem(
                            name,
                            `${this.msi.id}/${roleDefinition.id}`,
                            getIconPath(getAzExtResourceType({ type: `${provider}/${resourceType}` })),
                            roleDefinition,
                            // if the flag is false, this will be undefined
                            subscriptions.find(s => s.subscriptionId === scopeSplit[2])?.name);

                        roleDefinitionsItems.push(rdi);
                    } else {
                        roleDefinitionsItems.find((rdi) => rdi.label === name)?.addRoleDefinition(roleDefinition);
                    }
                }
            }));

        return roleDefinitionsItems;
    }
}
