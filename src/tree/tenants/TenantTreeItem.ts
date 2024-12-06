/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { TenantIdDescription } from '@azure/arm-resources-subscriptions';
import { nonNullValue } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { GenericItemOptions } from "../GenericItem";
import { ResourceGroupsItem } from '../ResourceGroupsItem';

export interface TenantItemOptions extends GenericItemOptions {
    readonly checkboxState?: vscode.TreeItemCheckboxState;
}

export class TenantTreeItem implements ResourceGroupsItem {
    public label: string;
    public tenantId: string;
    constructor(public readonly tenant: TenantIdDescription, public readonly account: vscode.AuthenticationSessionAccountInformation, private readonly options?: TenantItemOptions) {
        this.label = nonNullValue(this.tenant.displayName);
        this.tenantId = nonNullValue(this.tenant.tenantId);
    }

    readonly id: string = nonNullValue(this.tenant.tenantId);
    readonly accountId = this.account.id;


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
