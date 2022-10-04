/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ApplicationResource } from '../../../api/v2/v2AzureResourcesApi';
import { getIconPath } from '../../../utils/azureUtils';
import { ResourceGroupsItem } from '../ResourceGroupsItem';

export class DefaultApplicationResourceItem implements ResourceGroupsItem {
    constructor(private readonly resource: ApplicationResource) {
    }

    getChildren(): vscode.ProviderResult<ResourceGroupsItem[]> {
        return undefined;
    }

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.resource.name ?? 'Unnamed Resource');

        treeItem.iconPath = getIconPath(this.resource.resourceType);

        return treeItem;
    }

    id: string;
    name: string;
    type: string;
}
