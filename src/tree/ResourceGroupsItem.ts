/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeElementBase } from 'node_modules/@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';

export type TreeDataItem = ResourceGroupsItem | TreeElementBase;
export interface ResourceGroupsItem {
    readonly id: string;

    getParent?(): vscode.ProviderResult<ResourceGroupsItem>;
    getChildren(): vscode.ProviderResult<ResourceGroupsItem[]>;
    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;
}
