/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface ResourceGroupsItem {
    readonly id: string;

    /**
     * Override default isAncestorOf behavior based on paths.
     *
     * If defined, the item id will be excluded from paths of child items
     */
    isAncestorOf?(id: string): boolean;

    getChildren(): vscode.ProviderResult<ResourceGroupsItem[]>;
    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;
}
