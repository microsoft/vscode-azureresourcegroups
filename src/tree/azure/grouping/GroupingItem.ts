/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue, ISubscriptionContext, parseError, TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { AzExtResourceType, AzureResource, AzureResourceBranchDataProvider, AzureResourceModel, AzureSubscription } from '../../../../api/src/index';
import { ext } from '../../../extensionVariables';
import { getIconPath } from '../../../utils/azureUtils';
import { localize } from '../../../utils/localize';
import { createPortalUrl } from '../../../utils/v2/createPortalUrl';
import { BranchDataItemOptions } from '../../BranchDataItemWrapper';
import { GenericItem } from '../../GenericItem';
import { InvalidAzureResourceItem } from '../../InvalidAzureResourceItem';
import { ResourceGroupsItem } from '../../ResourceGroupsItem';
import { ResourceGroupsTreeContext } from '../../ResourceGroupsTreeContext';
import { BranchDataProviderFactory } from '../AzureResourceBranchDataProviderManager';
import { ResourceItemFactory } from '../AzureResourceItem';
import { GroupingItemFactoryOptions } from './GroupingItemFactory';

export class GroupingItem implements ResourceGroupsItem {
    readonly id: string;
    public readonly label: string;
    public readonly resources: AzureResource[];

    public readonly context?: ResourceGroupsTreeContext;
    public readonly parent?: ResourceGroupsItem;

    private readonly resourceItemFactory: ResourceItemFactory<AzureResource>;
    private readonly branchDataProviderFactory: (azureResource: AzureResource) => AzureResourceBranchDataProvider<AzureResourceModel>;
    private readonly onDidChangeBranchDataProviders: vscode.Event<AzExtResourceType>;

    protected readonly contextValues: string[] = ['groupingItem'];

    private description?: string;
    private readonly iconPath?: TreeItemIconPath;
    private readonly options?: GroupingItemDisplayOptions;

    constructor(options: GroupingItemOptions, factoryOptions: GroupingItemFactoryOptions) {
        this.resourceItemFactory = factoryOptions.resourceItemFactory;
        this.branchDataProviderFactory = factoryOptions.branchDataProviderFactory;
        this.onDidChangeBranchDataProviders = factoryOptions.onDidChangeBranchDataProviders;

        this.context = options.context;
        this.iconPath = options.iconPath;
        this.label = options.label;
        this.resources = options.resources;
        this.parent = options.parent;
        this.options = options.displayOptions;

        this.subscription = this.context ? {
            // for v1.5 compatibility
            ...this.context.subscriptionContext,
            ...this.context.subscription,
        } : undefined;

        if (this.context?.subscription) {
            this.id = `/subscriptions/${this.context?.subscriptionContext.subscriptionId}/account/${this.context?.subscription.account?.id}/groupings/${this.label}`;
        } else {
            // favorites groups don't always have a subscription
            this.id = `/groupings/${this.label}`;
        }
    }

    // Needed for context menu commands on the group tree items. E.g. "Create..."
    public readonly subscription?: ISubscriptionContext & AzureSubscription;

    getResourcesToDisplay(resources: AzureResource[]): AzureResource[] {
        // display all resources by default
        return resources;
    }

    async getChildren(): Promise<ResourceGroupsItem[] | undefined> {

        const sortedResources = this.getResourcesToDisplay(this.resources).sort((a, b) => {

            if (a.subscription !== b.subscription) {
                return a.subscription.name.localeCompare(b.subscription.name);
            }

            return a.name.localeCompare(b.name);
        });

        const subscriptionGroupingMap = new Map<AzureSubscription, AzureResource[]>();

        sortedResources.forEach(resource => {
            const sub = resource.subscription;
            subscriptionGroupingMap.set(sub, [...subscriptionGroupingMap.get(sub) ?? []].concat(resource));
        });

        this.onDidChangeBranchDataProviders((type: AzExtResourceType) => {
            const azExtResourceTypes = sortedResources.map(r => r.resourceType);
            if (azExtResourceTypes.includes(type)) {
                ext.actions.refreshAzureTree(this);
                ext.actions.refreshFocusTree(this);
            }
        });

        const resourceItems = await Promise.all(Array.from(subscriptionGroupingMap.keys()).map(
            async (subscription) => {
                const items: ResourceGroupsItem[] = [];

                if (!this.options?.hideSeparators && subscriptionGroupingMap.size > 1) {
                    items.push(new GenericItem('', { description: subscription.name }));
                }

                await Promise.allSettled((subscriptionGroupingMap.get(subscription) ?? []).map(async (resource): Promise<void> => {
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
                        const parsedError = parseError(e);
                        ext.outputChannel.appendLog(localize('errorResolving', 'Error resolving resource item for {0}: {1}', resource.id, parsedError.message));
                        items.push(new InvalidAzureResourceItem(resource, e));
                        throw parsedError;
                    }
                }));

                return items.sort((a, b) => (a.id.split('/').pop() ?? '').localeCompare((b.id.split('/').pop() ?? '')));
            }));

        // flatten resourceItems
        return resourceItems.reduce((acc, val) => acc.concat(val), []);
    }

    async getTreeItem(): Promise<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.label, this.options?.expandByDefault ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
        treeItem.contextValue = createContextValue(this.contextValues);
        treeItem.description = this.description;
        treeItem.iconPath = this.iconPath;
        treeItem.id = this.id;

        return treeItem;
    }

    getParent(): vscode.ProviderResult<ResourceGroupsItem> {
        return this.parent;
    }
}

export interface GroupingItemDisplayOptions {
    expandByDefault?: boolean;
    hideSeparators?: boolean;
}

export interface GroupingItemOptions {
    label: string,
    resources: AzureResource[],
    context?: ResourceGroupsTreeContext,
    contextValues?: string[],
    iconPath?: TreeItemIconPath,
    parent?: ResourceGroupsItem,
    displayOptions?: GroupingItemDisplayOptions,
}

export type GroupingItemFactory = (options: GroupingItemOptions) => GroupingItem;

export function createGroupingItemFactory(resourceItemFactory: ResourceItemFactory<AzureResource>, branchDataProviderFactory: BranchDataProviderFactory, onDidChangeBranchDataProviders: vscode.Event<AzExtResourceType>, defaultOptions?: GroupingItemDisplayOptions): GroupingItemFactory {
    return ({ context, contextValues, iconPath, label, resources, parent, displayOptions }) =>
        new GroupingItem(
            { context, contextValues, iconPath, label, resources, parent, displayOptions: { ...defaultOptions, ...displayOptions } },
            { resourceItemFactory, branchDataProviderFactory, onDidChangeBranchDataProviders, }
        );
}
