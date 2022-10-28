/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface ResourceGroupsItem {
    readonly id: string;

    isAncestorOf?(id: string): boolean;

    getChildren(): vscode.ProviderResult<ResourceGroupsItem[]>;
    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;
}
