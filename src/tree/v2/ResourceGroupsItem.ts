/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ResourceModelBase } from '../../api/v2/v2AzureResourcesApi';

export interface ResourceGroupsItem extends ResourceModelBase{
    getChildren(): vscode.ProviderResult<ResourceGroupsItem[]>;
    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;
}
