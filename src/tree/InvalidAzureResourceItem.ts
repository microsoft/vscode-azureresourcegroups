/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { createContextValue, parseError } from '@microsoft/vscode-azext-utils';
import { AzureResource } from 'api/src/resources/azure';
import * as vscode from 'vscode';
import { getIconPath } from '../utils/azureUtils';
import { localize } from '../utils/localize';
import { createPortalUrl } from '../utils/v2/createPortalUrl';
import { InvalidItem } from './InvalidItem';
import { ResourceGroupsItem } from "./ResourceGroupsItem";

export class InvalidAzureResourceItem implements ResourceGroupsItem {
    public readonly portalUrl: vscode.Uri;

    constructor(private readonly resource: AzureResource, private readonly error: unknown) {
        this.portalUrl = createPortalUrl(resource.subscription, resource.id);
    }

    public readonly id: string = this.resource.id;

    getChildren(): Promise<ResourceGroupsItem[] | undefined> {
        return Promise.resolve([new InvalidItem(parseError(this.error))]);
    }

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.resource.name, vscode.TreeItemCollapsibleState.Collapsed);
        treeItem.iconPath = getIconPath(this.resource.resourceType);
        treeItem.contextValue = createContextValue(['invalid', 'azureResource', 'hasPortalUrl']);
        treeItem.description = localize('error', 'Error');

        return treeItem;
    }
}
