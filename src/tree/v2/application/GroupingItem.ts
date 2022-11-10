/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OpenInPortalOptions } from '@microsoft/vscode-azext-azureutils';
import { TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ApplicationResource, ApplicationResourceBranchDataProvider, ApplicationResourceModel, ApplicationSubscription } from '../../../api/v2/v2AzureResourcesApi';
import { getIconPath } from '../../../utils/azureUtils';
import { BranchDataItemFactory, BranchDataItemOptions } from '../BranchDataProviderItem';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceGroupsTreeContext } from '../ResourceGroupsTreeContext';
import { BranchDataProviderFactory } from './ApplicationResourceBranchDataProviderManager';

// TODO: This should be moved to the common library, for use by other extensions.
function createPortalUrl(subscription: ApplicationSubscription, id: string, options?: OpenInPortalOptions): vscode.Uri {
    const queryPrefix: string = (options && options.queryPrefix) ? `?${options.queryPrefix}` : '';
    const url: string = `${subscription.environment.portalUrl}/${queryPrefix}#@${subscription.tenantId}/resource${id}`;

    return vscode.Uri.parse(url);
}

export class GroupingItem implements ResourceGroupsItem {
    private description: string | undefined;

    constructor(
        public readonly context: ResourceGroupsTreeContext,
        private readonly branchDataItemFactory: BranchDataItemFactory,
        private readonly branchDataProviderFactory: (ApplicationResource) => ApplicationResourceBranchDataProvider<ApplicationResourceModel>,
        private readonly contextValues: string[] | undefined,
        private readonly iconPath: TreeItemIconPath | undefined,
        public readonly label: string,
        public readonly resources: ApplicationResource[]) {
    }

    readonly id: string = `groupings/${this.label}`;

    async getChildren(): Promise<ResourceGroupsItem[] | undefined> {
        const sortedResources = this.resources.sort((a, b) => a.name.localeCompare(b.name));
        const resourceItems = await Promise.all(sortedResources.map(
            async resource => {
                const branchDataProvider = this.branchDataProviderFactory(resource);
                const resourceItem = await branchDataProvider.getResourceItem(resource);

                const options: BranchDataItemOptions = {
                    contextValues: ['azureResource'],
                    defaultId: resource.id,
                    defaults: {
                        iconPath: getIconPath(resource.resourceType)
                    },
                    portalUrl: resourceItem.portalUrl ?? createPortalUrl(resource.subscription, resource.id),
                    viewProperties: {
                        label: resource.name,
                        data: resource.raw
                    }
                };

                return this.branchDataItemFactory(resourceItem, branchDataProvider, options);
            }));

        return resourceItems;
    }

    async getTreeItem(): Promise<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.Collapsed);

        treeItem.contextValue = this.contextValues?.join(' ');
        treeItem.description = this.description;
        treeItem.iconPath = this.iconPath;

        return treeItem;
    }

    async withDescription(description: string, callback: () => Promise<void>): Promise<void> {
        this.description = description;
        this.context.refresh(this);

        try {
            await callback();
        } finally {
            this.description = undefined;
            this.context.refresh(this);
        }
    }
}

export type GroupingItemFactory = (context: ResourceGroupsTreeContext, contextValues: string[] | undefined, iconPath: TreeItemIconPath | undefined, label: string, resources: ApplicationResource[]) => GroupingItem;

export function createGroupingItemFactory(branchDataItemFactory: BranchDataItemFactory, branchDataProviderFactory: BranchDataProviderFactory): GroupingItemFactory {
    return (context, contextValues, iconPath, label, resources) => new GroupingItem(context, branchDataItemFactory, branchDataProviderFactory, contextValues, iconPath, label, resources);
}
