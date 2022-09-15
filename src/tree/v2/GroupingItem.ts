import { TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ApplicationResource, BranchDataProvider, ResourceModelBase } from '../../api/v2/v2AzureResourcesApi';
import { getIconPath } from '../../utils/azureUtils';
import { BranchDataItemFactory } from './BranchDataItem';
import { BranchDataProviderFactory } from './providers/BranchDataProviderManager';
import { ResourceGroupsItem } from './ResourceGroupsItem';
import { ResourceGroupsTreeContext } from './ResourceGroupsTreeContext';

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

    public get quickPickOptions(): { readonly contextValues: string[]; readonly isLeaf: boolean; } {
        return {
            contextValues: this.contextValues ?? [],
            isLeaf: false
        };
    }

    async getChildren(): Promise<ResourceGroupsItem[] | undefined> {
        const resourceItems = await Promise.all(this.resources.map(
            async resource => {
                const branchDataProvider = this.branchDataProviderFactory(resource);
                const resourceItem = await branchDataProvider.getResourceItem(resource);

                const options = {
                    defaults: {
                        iconPath: getIconPath(resource.azExtResourceType)
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

    public id: string;
}

export type GroupingItemFactory = (context: ResourceGroupsTreeContext, contextValues: string[] | undefined, iconPath: TreeItemIconPath | undefined, label: string, resources: ApplicationResource[], resourceType: string | undefined) => GroupingItem;

export function createGroupingItemFactory(branchDataItemFactory: BranchDataItemFactory, branchDataProviderFactory: BranchDataProviderFactory): GroupingItemFactory {
    return (context, contextValues, iconPath, label, resources, resourceType) => new GroupingItem(context, branchDataItemFactory, branchDataProviderFactory, contextValues, iconPath, label, resources, resourceType);
}
