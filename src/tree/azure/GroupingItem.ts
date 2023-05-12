/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue, ISubscriptionContext, TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { AzExtResourceType, AzureResource, AzureResourceBranchDataProvider, AzureResourceModel, AzureSubscription, ViewPropertiesModel } from '../../../api/src/index';
import { ITagsModel, ResourceTags } from '../../commands/tags/TagFileSystem';
import { ext } from '../../extensionVariables';
import { getIconPath } from '../../utils/azureUtils';
import { createPortalUrl } from '../../utils/v2/createPortalUrl';
import { BranchDataItemOptions } from '../BranchDataItemWrapper';
import { GenericItem } from '../GenericItem';
import { InvalidAzureResourceItem } from '../InvalidAzureResourceItem';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceGroupsTreeContext } from '../ResourceGroupsTreeContext';
import { BranchDataProviderFactory } from './AzureResourceBranchDataProviderManager';
import { ResourceItemFactory } from './AzureResourceItem';

export class GroupingItem implements ResourceGroupsItem {
    private description: string | undefined;

    // only defined if this is a resource group
    readonly viewProperties?: ViewPropertiesModel;
    readonly tagsModel?: ITagsModel;
    readonly portalUrl?: vscode.Uri;

    constructor(
        public readonly context: ResourceGroupsTreeContext | undefined,
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
        public readonly location?: string,
        private readonly options?: GroupingItemOptions,
    ) {
        if (resourceGroup) {
            this.tagsModel = new ResourceTags(resourceGroup);
            this.viewProperties = {
                label: resourceGroup.name,
                data: resourceGroup.raw
            };
            this.portalUrl = createPortalUrl(resourceGroup.subscription, resourceGroup.id);
        }

        this.subscription = this.context ? {
            // for v1.5 compatibility
            ...this.context.subscriptionContext,
            ...this.context.subscription,
        } : undefined;

        if (this.resourceGroup) {
            this.id = this.resourceGroup.id;
        } else {
            if (this.context?.subscription) {
                this.id = `/subscriptions/${this.context?.subscriptionContext.subscriptionId}/groupings/${this.label}`;
            } else {
                this.id = `/groupings/${this.label}`;
            }
        }
    }

    // Needed for context menu commands on the group tree items. E.g. "Create..."
    public readonly subscription?: ISubscriptionContext & AzureSubscription;

    readonly id: string;

    async getChildren(): Promise<ResourceGroupsItem[] | undefined> {

        const sortedResources = this.resources.sort((a, b) => {

            if (a.subscription !== b.subscription) {
                return a.subscription.name.localeCompare(b.subscription.name);
            }

            return a.name.localeCompare(b.name);
        });

        const groupMap = new Map<AzureSubscription, AzureResource[]>();

        sortedResources.forEach(resource => {
            const sub = resource.subscription;
            groupMap.set(sub, [...groupMap.get(sub) ?? []].concat(resource));
        });

        this.onDidChangeBranchDataProviders((type: AzExtResourceType) => {
            const azExtResourceTypes = sortedResources.map(r => r.resourceType);
            if (azExtResourceTypes.includes(type)) {
                ext.actions.refreshAzureTree(this);
                ext.actions.refreshAzureFavorites(this);
            }
        });

        const resourceItems = await Promise.all(Array.from(groupMap.keys()).map(
            async (subscription) => {
                const items: ResourceGroupsItem[] = [];

                const alwaysShowSeparator = false;
                if (!this.options?.hideSeparators && alwaysShowSeparator || groupMap.size > 1) {
                    items.push(new GenericItem('', { description: subscription.name }));
                }

                for await (const resource of groupMap.get(subscription) ?? []) {
                    try {
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

                        items.push(this.resourceItemFactory(resource, resourceItem, branchDataProvider, this, options));
                    } catch (e) {
                        items.push(new InvalidAzureResourceItem(resource, e));
                    }
                }
                return items;
            }));

        // flatten resourceItems
        return resourceItems.reduce((acc, val) => acc.concat(val), []);
    }

    async getTreeItem(): Promise<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.label, this.options?.expandByDefault ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);

        const contextValuesToAdd: string[] = ['groupingItem'];
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
}

interface GroupingItemOptions {
    expandByDefault?: boolean;
    hideSeparators?: boolean;
}

export type GroupingItemFactory = (context: ResourceGroupsTreeContext | undefined, contextValues: string[] | undefined, iconPath: TreeItemIconPath | undefined, label: string, resources: AzureResource[], resourceType: AzExtResourceType | undefined, parent?: ResourceGroupsItem, resourceGroup?: AzureResource, location?: string, options?: GroupingItemOptions) => GroupingItem;

export function createGroupingItemFactory(resourceItemFactory: ResourceItemFactory<AzureResource>, branchDataProviderFactory: BranchDataProviderFactory, onDidChangeBranchDataProvider: vscode.Event<AzExtResourceType>, defaultOptions?: GroupingItemOptions): GroupingItemFactory {
    return (context, contextValues, iconPath, label, resources, resourceType, parent, resourceGroup, location, options) => new GroupingItem(context, resourceItemFactory, branchDataProviderFactory, onDidChangeBranchDataProvider, contextValues, iconPath, label, resources, resourceType, parent, resourceGroup, location, { ...defaultOptions, ...options });
}
