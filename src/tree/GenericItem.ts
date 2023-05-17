/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ResourceGroupsItem } from "./ResourceGroupsItem";

export interface GenericItemOptions {
    readonly children?: ResourceGroupsItem[];
    readonly commandArgs?: unknown[];
    readonly commandId?: string;
    readonly contextValue?: string;
    readonly iconPath?: TreeItemIconPath;
    readonly description?: string;
}

export class GenericItem implements ResourceGroupsItem {
    constructor(public readonly label: string, private readonly options?: GenericItemOptions) {
    }

    readonly id: string = this.label;

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

        return treeItem;
    }
}
