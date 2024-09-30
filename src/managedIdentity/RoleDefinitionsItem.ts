/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { RoleDefinition } from "@azure/arm-authorization";
import { TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { TreeItem, TreeItemCollapsibleState } from "vscode";
import { GenericItem } from "../tree/GenericItem";
import { ResourceGroupsItem } from "../tree/ResourceGroupsItem";

export class RoleDefinitionsItem implements ResourceGroupsItem {
    public id: string;
    public label: string;
    public iconPath: TreeItemIconPath;
    public roleDefintions: RoleDefinition[] = [];

    constructor(label: string, id: string, iconPath: TreeItemIconPath, roleDefintion: RoleDefinition, readonly description?: string) {
        this.label = label;
        this.id = id;
        this.iconPath = iconPath;
        this.roleDefintions.push(roleDefintion);
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
            return new GenericItem("", { description: rd.roleName });
        });
    }

    addRoleDefinition(roleDefinition: RoleDefinition): void {
        if (!this.roleDefintions.some((rd) => rd.roleName === roleDefinition.roleName)) {
            this.roleDefintions.push(roleDefinition);
        }
    }
}
