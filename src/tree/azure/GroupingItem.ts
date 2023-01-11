/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtResourceType, createContextValue, ISubscriptionContext, TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import { AzureResource, AzureResourceBranchDataProvider, AzureResourceModel, ViewPropertiesModel } from '@microsoft/vscode-azext-utils/hostapi.v2';
import * as vscode from 'vscode';
import { ITagsModel, ResourceTags } from '../../commands/tags/TagFileSystem';
import { ext } from '../../extensionVariables';
import { getIconPath } from '../../utils/azureUtils';
import { createPortalUrl } from '../../utils/v2/createPortalUrl';
import { BranchDataItemOptions } from '../BranchDataProviderItem';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceGroupsTreeContext } from '../ResourceGroupsTreeContext';
import { treeItemState } from '../TreeItemState';
import { BranchDataProviderFactory } from './AzureResourceBranchDataProviderManager';
import { ResourceItemFactory } from './AzureResourceItem';

export class GroupingItem implements ResourceGroupsItem {
    private description: string | undefined;

    // only defined if this is a resource group
    readonly viewProperties?: ViewPropertiesModel;
    readonly tagsModel?: ITagsModel;
    readonly portalUrl?: vscode.Uri;

    constructor(
        public readonly context: ResourceGroupsTreeContext,
        private readonly resourceItemFactory: ResourceItemFactory<AzureResource>,
        private readonly branchDataProviderFactory: (azureResource: AzureResource) => AzureResourceBranchDataProvider<AzureResourceModel>,
        private readonly onDidChangeBranchDataProviders: vscode.Event<AzExtResourceType>,
        private readonly contextValues: string[] | undefined,
        private readonly iconPath: TreeItemIconPath | undefined,
        public readonly label: string,
        public readonly resources: AzureResource[],
        public readonly resourceType: AzExtResourceType | undefined,
        public readonly parent?: ResourceGroupsItem,
        public readonly resourceGroup?: AzureResource,
    ) {
        if (resourceGroup) {
            this.tagsModel = new ResourceTags(resourceGroup);
            this.viewProperties = {
                label: resourceGroup.name,
                data: resourceGroup.raw
            };
            this.portalUrl = createPortalUrl(resourceGroup.subscription, resourceGroup.id);
        }
        treeItemState.onDidRequestRefresh(this.id, () => this.context.refresh(this));
    }

    // Needed for context menu commands on the group tree items. E.g. "Create..."
    public get subscription(): ISubscriptionContext {
        return this.context.subscriptionContext;
    }

    readonly id: string = this.resourceGroup ? this.resourceGroup.id : `/subscriptions/${this.context.subscriptionContext.subscriptionId}/groupings/${this.label}`;

    async getChildren(): Promise<ResourceGroupsItem[] | undefined> {
        const sortedResources = this.resources.sort((a, b) => a.name.localeCompare(b.name));

        this.onDidChangeBranchDataProviders((type: AzExtResourceType) => {
            const azExtResourceTypes = sortedResources.map(r => r.resourceType);
            if (azExtResourceTypes.includes(type)) {
                ext.actions.refreshAzureTree(this);
            }
        });

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

        const contextValuesToAdd: string[] = [];
        if (this.resourceGroup) {
            contextValuesToAdd.push('hasPortalUrl');
        }

        treeItem.contextValue = createContextValue((this.contextValues ?? []).concat(contextValuesToAdd));
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

export type GroupingItemFactory = (context: ResourceGroupsTreeContext, contextValues: string[] | undefined, iconPath: TreeItemIconPath | undefined, label: string, resources: AzureResource[], resourceType: AzExtResourceType | undefined, parent: ResourceGroupsItem, resourceGroup?: AzureResource) => GroupingItem;

export function createGroupingItemFactory(resourceItemFactory: ResourceItemFactory<AzureResource>, branchDataProviderFactory: BranchDataProviderFactory, onDidChangeBranchDataProvider: vscode.Event<AzExtResourceType>): GroupingItemFactory {
    return (context, contextValues, iconPath, label, resources, resourceType, parent, resourceGroup) => new GroupingItem(context, resourceItemFactory, branchDataProviderFactory, onDidChangeBranchDataProvider, contextValues, iconPath, label, resources, resourceType, parent, resourceGroup);
}
