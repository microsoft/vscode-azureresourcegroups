/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AuthorizationManagementClient, RoleAssignment } from "@azure/arm-authorization";
import { Identity } from "@azure/arm-msi";
import { createSubscriptionContext } from "@microsoft/vscode-azext-utils";
import { ProviderResult, TreeItem, TreeItemCollapsibleState } from "vscode";
import { AzureSubscription } from "../../api/src";
import { GenericItem } from "../tree/GenericItem";
import { ResourceGroupsItem } from "../tree/ResourceGroupsItem";
import { RoleDefinitionsItem } from "./RoleDefinitionsItem";

export class RoleAssignmentsItem implements ResourceGroupsItem {
    public id: string;
    public label: string;
    private children: (RoleDefinitionsItem | GenericItem)[] = [];

    constructor(label: string, readonly subscription: AzureSubscription, readonly msi: Identity) {
        this.label = label;
        this.id = `${msi.id}/${label}`;
    }

    getChildren(): ProviderResult<ResourceGroupsItem[]> {
        return this.children;
    }

    getTreeItem(): TreeItem {
        return {
            label: this.label,
            id: this.id,
            collapsibleState: this.children.length < 10 ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
        }
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
        await Promise.all(roleAssignments
            .map(async (ra) => {
                if (!ra.scope || !ra.roleDefinitionId) {
                    return;
                }
                const scopeSplit = ra.scope.split('/');
                const name = scopeSplit.pop();
                if (name && (!fromOtherSubs || !ra.scope?.includes(this.subscription.subscriptionId))) {
                    const roleDefinition = await authClient.roleDefinitions.getById(ra.roleDefinitionId);
                    if (!roleDefinitionsItems.some((rdi) => rdi.label === name)) {
                        const rdi = await RoleDefinitionsItem.createRoleDefinitionsItem(ra.scope, roleDefinition, this.msi.id, fromOtherSubs);
                        roleDefinitionsItems.push(rdi);
                    } else {
                        roleDefinitionsItems.find((rdi) => rdi.label === name)?.addRoleDefinition(roleDefinition);
                    }
                }
            }));

        return roleDefinitionsItems;
    }
}
