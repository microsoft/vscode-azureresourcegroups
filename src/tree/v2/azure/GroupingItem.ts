/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OpenInPortalOptions } from '@microsoft/vscode-azext-azureutils';
import { AzExtResourceType, createContextValue, ISubscriptionContext, TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { AzureResource, AzureResourceBranchDataProvider, AzureResourceModel, AzureSubscription } from '../../../api/v2/v2AzureResourcesApi';
import { getIconPath } from '../../../utils/azureUtils';
import { BranchDataItemOptions } from '../BranchDataProviderItem';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceGroupsTreeContext } from '../ResourceGroupsTreeContext';
import { BranchDataProviderFactory } from './AzureResourceBranchDataProviderManager';
import { ResourceItemFactory } from './AzureResourceItem';

// TODO: This should be moved to the common library, for use by other extensions.
function createPortalUrl(subscription: AzureSubscription, id: string, options?: OpenInPortalOptions): vscode.Uri {
    const queryPrefix: string = (options && options.queryPrefix) ? `?${options.queryPrefix}` : '';
    const url: string = `${subscription.environment.portalUrl}/${queryPrefix}#@${subscription.tenantId}/resource${id}`;

    return vscode.Uri.parse(url);
}

export class GroupingItem implements ResourceGroupsItem {
    private description: string | undefined;

    constructor(
        public readonly context: ResourceGroupsTreeContext,
        private readonly resourceItemFactory: ResourceItemFactory<AzureResource>,
        private readonly branchDataProviderFactory: (azureResource: AzureResource) => AzureResourceBranchDataProvider<AzureResourceModel>,
        private readonly contextValues: string[] | undefined,
        private readonly iconPath: TreeItemIconPath | undefined,
        public readonly label: string,
        public readonly resources: AzureResource[],
        public readonly resourceType: AzExtResourceType | undefined,
        public readonly parent?: ResourceGroupsItem
    ) { }

    // Needed for context menu commands on the group tree items. E.g. "Create..."
    public get subscription(): ISubscriptionContext {
        return this.context.subscriptionContext;
    }

    readonly id: string = `/subscriptions/${this.context.subscriptionContext.subscriptionId}/groupings/${this.label}`;

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
                    viewProperties: resourceItem.viewProperties ?? {
                        label: resource.name,
                        data: resource.raw
                    }
                };

                return this.resourceItemFactory(resource, resourceItem, branchDataProvider, this, options);
            }));

        return resourceItems;
    }

    async getTreeItem(): Promise<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.Collapsed);

        treeItem.contextValue = createContextValue(this.contextValues ?? []);
        treeItem.description = this.description;
        treeItem.iconPath = this.iconPath;
        treeItem.id = this.id;

        return treeItem;
    }

    getParent(): vscode.ProviderResult<ResourceGroupsItem> {
        return this.parent;
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

export type GroupingItemFactory = (context: ResourceGroupsTreeContext, contextValues: string[] | undefined, iconPath: TreeItemIconPath | undefined, label: string, resources: AzureResource[], resourceType: AzExtResourceType | undefined, parent: ResourceGroupsItem) => GroupingItem;

export function createGroupingItemFactory(resourceItemFactory: ResourceItemFactory<AzureResource>, branchDataProviderFactory: BranchDataProviderFactory): GroupingItemFactory {
    return (context, contextValues, iconPath, label, resources, resourceType, parent) => new GroupingItem(context, resourceItemFactory, branchDataProviderFactory, contextValues, iconPath, label, resources, resourceType, parent);
}
