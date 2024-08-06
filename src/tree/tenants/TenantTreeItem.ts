/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { GenericItemOptions } from "../GenericItem";
import { ResourceGroupsItem } from '../ResourceGroupsItem';

export interface TenantItemOptions extends GenericItemOptions {
    readonly checkboxState?: vscode.TreeItemCheckboxState;
}

export class TenantTreeItem implements ResourceGroupsItem {
    constructor(public readonly label: string, public tenantId: string, public account: string, private readonly options?: TenantItemOptions) {
    }

    readonly id: string = this.tenantId;
    readonly accountId: string = this.account

    getChildren(): vscode.ProviderResult<ResourceGroupsItem[]> {
        return this.options?.children;
    }

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.label, this.options?.children ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);

        if (this.options?.commandId) {
            treeItem.command = {
                arguments: this.options.commandArgs,
                command: this.options.commandId,
                title: ''
            };
        }

        treeItem.description = this.options?.description;
        treeItem.contextValue = this.options?.contextValue;
        treeItem.iconPath = this.options?.iconPath;
        treeItem.checkboxState = this.options?.checkboxState;

        return treeItem;
    }
}
