/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { AzureResource } from '../../../api/src/index';
import { AzExtWrapper, getAzureExtensions } from '../../AzExtWrapper';
import { getIconPath } from '../../utils/azureUtils';
import { localize } from "../../utils/localize";
import { createPortalUrl } from '../../utils/v2/createPortalUrl';
import { GenericItem } from '../GenericItem';
import { ResourceGroupsItem } from '../ResourceGroupsItem';

export class DefaultAzureResourceItem implements ResourceGroupsItem {
    private readonly resourceTypeExtension: AzExtWrapper | undefined;
    public readonly portalUrl: vscode.Uri;

    constructor(private readonly resource: AzureResource) {
        this.resourceTypeExtension = getAzureExtensions().find(ext => ext.matchesApplicationResourceType(resource));
        this.portalUrl = createPortalUrl(resource.subscription, resource.id);
    }

    public readonly id: string = this.resource.id;

    getChildren(): Promise<ResourceGroupsItem[] | undefined> {
        if (this.resourceTypeExtension && !this.resourceTypeExtension.isInstalled() && !this.resourceTypeExtension.isPrivate()) {
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
        treeItem.contextValue = createContextValue(['azureResource', 'hasPortalUrl']);

        return treeItem;
    }
}
