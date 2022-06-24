import { TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ApplicationResource, BranchDataProvider, ResourceModelBase } from '../../api/v2/v2AzureResourcesApi';
import { BranchDataItemFactory } from './BranchDataItem';
import { BranchDataProviderFactory } from './providers/BranchDataProviderManager';
import { ResourceGroupItem } from './ResourceGroupItem';

export class GroupingItem implements ResourceGroupItem {
    constructor(
        private readonly branchDataItemFactory: BranchDataItemFactory,
        private readonly branchDataProviderFactory: (ApplicationResource) => BranchDataProvider<ApplicationResource, ResourceModelBase>,
        private readonly iconPath: TreeItemIconPath | undefined,
        public readonly label: string,
        private readonly resources: ApplicationResource[]) {
    }

    async getChildren(): Promise<ResourceGroupItem[] | undefined> {
        const resourceItems = await Promise.all(this.resources.map(
            async resource => {
                const branchDataProvider = this.branchDataProviderFactory(resource);
                const resourceItem = await branchDataProvider.getResourceItem(resource);

                return this.branchDataItemFactory(resourceItem, branchDataProvider);
            }));

        return resourceItems;
    }

    async getTreeItem(): Promise<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.Collapsed);

        treeItem.iconPath = this.iconPath;

        return treeItem;
    }

    id: string;
    name: string;
    type: string;
}

export type GroupingItemFactory = (iconPath: TreeItemIconPath | undefined, label: string, resources: ApplicationResource[]) => GroupingItem;

export function createGroupingItemFactory(branchDataItemFactory: BranchDataItemFactory, branchDataProviderFactory: BranchDataProviderFactory): GroupingItemFactory {
    return (iconPath, label, resources) => new GroupingItem(branchDataItemFactory, branchDataProviderFactory, iconPath, label, resources);
}
