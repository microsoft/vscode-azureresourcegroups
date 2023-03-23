/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { IParsedError } from "@microsoft/vscode-azext-utils";
import { v4 as uuidv4 } from "uuid";
import { ProviderResult, ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ResourceGroupsItem } from "./ResourceGroupsItem";

export class InvalidItem implements ResourceGroupsItem {
    constructor(public readonly error: IParsedError) { }
    id = uuidv4();

    getTreeItem(): TreeItem {
        return {
            collapsibleState: TreeItemCollapsibleState.None,
            contextValue: 'invalidItem',
            iconPath: new ThemeIcon('warning'),
            id: this.id,
            label: this.error.message,
        }
    }

    getChildren(): ProviderResult<ResourceGroupsItem[]> {
        return [];
    }
}
