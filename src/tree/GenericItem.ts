/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ResourceGroupsItem } from "./ResourceGroupsItem";

export interface GenericItemOptions {
    readonly id?: string;
    readonly children?: ResourceGroupsItem[];
    readonly commandArgs?: unknown[];
    readonly commandId?: string;
    readonly contextValue?: string;
    readonly iconPath?: TreeItemIconPath;
    readonly description?: string;
    readonly collapsibleState?: vscode.TreeItemCollapsibleState;
    readonly checkboxState?: vscode.TreeItemCheckboxState | {
        /**
         * The {@link TreeItemCheckboxState} of the tree item
         */
        readonly state: vscode.TreeItemCheckboxState;
        /**
         * A tooltip for the checkbox
         */
        readonly tooltip?: string;
        /**
         * Accessibility information used when screen readers interact with this checkbox
         */
        readonly accessibilityInformation?: vscode.AccessibilityInformation;
    };
}

export class GenericItem implements ResourceGroupsItem {
    constructor(public readonly label: string, private readonly options?: GenericItemOptions) {
        this.id = options?.id ?? label;
    }

    readonly id: string;

    getChildren(): vscode.ProviderResult<ResourceGroupsItem[]> {
        return this.options?.children;
    }

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.label, this.options?.collapsibleState ?? (this.options?.children ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None));

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
