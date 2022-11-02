/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ApplicationResource } from '../../../api/v2/v2AzureResourcesApi';
import { getIconPath } from '../../../utils/azureUtils';
import { localize } from "../../../utils/localize";
import { GenericItem } from '../GenericItem';
import { ResourceGroupsItem } from '../ResourceGroupsItem';

export class DefaultApplicationResourceItem implements ResourceGroupsItem {
    constructor(private readonly resource: ApplicationResource) {
    }

    public readonly id: string = this.resource.id;

    /**
     * Returns true if the resource type extension is installed,
     * false if the resource type extension is not installed,
     * otherwise undefined if no extension is associated with the resource type.
     */
    private readonly isResourceTypeExtensionInstalled: boolean | undefined = false;

    getChildren(): Promise<ResourceGroupsItem[] | undefined> {
        if (this.isResourceTypeExtensionInstalled === false) {
            return Promise.resolve([
                new GenericItem(
                    localize('installExtensionToEnableFeatures', 'Install extension to enable additional features...'),
                    {
                        commandArgs: [ 'TODO: Extension ID' ],
                        commandId: 'azureResourceGroups.installExtension',
                        contextValue: 'installExtension',
                        iconPath: new vscode.ThemeIcon('extensions')
                    })
            ]);
        } else {
            return Promise.resolve(undefined);
        }
    }

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.resource.name ?? 'Unnamed Resource', this.isResourceTypeExtensionInstalled === false ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);

        treeItem.iconPath = getIconPath(this.resource.resourceType);

        return treeItem;
    }
}
