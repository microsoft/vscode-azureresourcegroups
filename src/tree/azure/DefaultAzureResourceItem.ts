/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureResource } from '@microsoft/vscode-azext-utils/hostapi.v2';
import * as vscode from 'vscode';
import { AzExtWrapper, getAzureExtensions } from '../../AzExtWrapper';
import { getIconPath } from '../../utils/azureUtils';
import { localize } from "../../utils/localize";
import { GenericItem } from '../GenericItem';
import { ResourceGroupsItem } from '../ResourceGroupsItem';

export class DefaultAzureResourceItem implements ResourceGroupsItem {
    private readonly resourceTypeExtension: AzExtWrapper | undefined;

    constructor(private readonly resource: AzureResource) {
        this.resourceTypeExtension = getAzureExtensions().find(ext => ext.matchesApplicationResourceType(resource));
    }

    public readonly id: string = this.resource.id;

    getChildren(): Promise<ResourceGroupsItem[] | undefined> {
        if (this.resourceTypeExtension && !this.resourceTypeExtension.isInstalled()) {
            return Promise.resolve([
                new GenericItem(
                    localize('installExtensionToEnableFeatures', 'Install extension to enable additional features...'),
                    {
                        commandArgs: [this.resourceTypeExtension.id],
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
        const isResourceTypeExtensionInstalled = this.resourceTypeExtension?.isInstalled();

        const treeItem = new vscode.TreeItem(this.resource.name ?? 'Unnamed Resource', isResourceTypeExtensionInstalled === false ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);

        treeItem.iconPath = getIconPath(this.resource.resourceType);
        treeItem.contextValue = 'azureResource';

        return treeItem;
    }
}
