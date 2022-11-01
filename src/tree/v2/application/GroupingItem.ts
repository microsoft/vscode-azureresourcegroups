/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISubscriptionContext, TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ApplicationResource, BranchDataProvider, ResourceModelBase } from '../../../api/v2/v2AzureResourcesApi';
import { getIconPath } from '../../../utils/azureUtils';
import { BranchDataItemFactory } from '../BranchDataProviderItem';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceGroupsTreeContext } from '../ResourceGroupsTreeContext';
import { BranchDataProviderFactory } from './ApplicationResourceBranchDataProviderManager';

export class GroupingItem implements ResourceGroupsItem {
    private description: string | undefined;

    constructor(
        public readonly context: ResourceGroupsTreeContext,
        private readonly branchDataItemFactory: BranchDataItemFactory,
        private readonly branchDataProviderFactory: (ApplicationResource) => BranchDataProvider<ApplicationResource, ResourceModelBase>,
        private readonly contextValues: string[] | undefined,
        private readonly iconPath: TreeItemIconPath | undefined,
        public readonly label: string,
        public readonly resources: ApplicationResource[],
        public readonly resourceType: string | undefined
    ) {
    }

    public get subscription(): ISubscriptionContext {
        return this.context.subscriptionContext;
    }

    readonly id: string = `groupings/${this.label}`;

    isAncestorOf(id: string): boolean {
        return this.resources.some(resource => id === resource.id || id.startsWith(resource.id));
    }

    async getChildren(): Promise<ResourceGroupsItem[] | undefined> {
        const sortedResources = this.resources.sort((a, b) => a.name.localeCompare(b.name));
        const resourceItems = await Promise.all(sortedResources.map(
            async resource => {
                const branchDataProvider = this.branchDataProviderFactory(resource);
                const resourceItem = await branchDataProvider.getResourceItem(resource);

                const options = {
                    defaultId: resource.id,
                    defaults: {
                        iconPath: getIconPath(resource.resourceType)
                    }
                };

                return this.branchDataItemFactory(resourceItem, branchDataProvider, options);
            }));

        return resourceItems;
    }

    async getTreeItem(): Promise<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.Collapsed);

        treeItem.contextValue = this.contextValues?.sort().join(';');
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

export type GroupingItemFactory = (context: ResourceGroupsTreeContext, contextValues: string[] | undefined, iconPath: TreeItemIconPath | undefined, label: string, resources: ApplicationResource[], resourceType: string | undefined) => GroupingItem;

export function createGroupingItemFactory(branchDataItemFactory: BranchDataItemFactory, branchDataProviderFactory: BranchDataProviderFactory): GroupingItemFactory {
    return (context, contextValues, iconPath, label, resources, resourceType) => new GroupingItem(context, branchDataItemFactory, branchDataProviderFactory, contextValues, iconPath, label, resources, resourceType);
}
