/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeElementBase } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { TreeTraversalContext } from '../utils/treeOperations';

export type TreeDataItem = ResourceGroupsItem | TreeElementBase;
export interface ResourceGroupsItem {
    readonly id: string;

    getParent?(): vscode.ProviderResult<ResourceGroupsItem>;
    getChildren(context?: TreeTraversalContext): vscode.ProviderResult<ResourceGroupsItem[]>;
    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;
}
