/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ThemeIcon } from "vscode";
import { ext } from "../extensionVariables";
import { GenericItem } from "../tree/GenericItem";
import { RoleAssignmentsItem } from "./RoleAssignmentsItem";
import { RoleDefinitionsItem } from "./RoleDefinitionsItem";

export async function loadAllSubscriptionRoleAssignments(context: IActionContext, node: RoleAssignmentsItem) {
    node.removeLastChild()
    node.addChild(new GenericItem('', { id: `${node.id}/loading`, iconPath: new ThemeIcon('sync~spin'), description: 'Loading...' }));
    ext.managedIdentityBranchDataProvider.refresh(node);

    const roleAssignments = await ext.managedIdentityBranchDataProvider.roleAssignmentsTask;
    const subscriptionRoleAssignments = Object.keys(roleAssignments);
    const filteredBySub = subscriptionRoleAssignments.map((subscription) => {
        return (roleAssignments)[subscription].filter((ra) => ra.principalId === node.msi.principalId)
    }).filter((ra) => ra.length > 0).flat();

    const roleDefinitionsItems: RoleDefinitionsItem[] = await node.getRoleDefinitionsItems(context, filteredBySub, true);

    node.removeLastChild();
    node.addChildren(roleDefinitionsItems);
    ext.managedIdentityBranchDataProvider.refresh(node);
}
