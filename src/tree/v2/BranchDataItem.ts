import * as vscode from 'vscode';
import { ApplicationResource, BranchDataProvider, ResourceModelBase } from '../../api/v2/v2AzureResourcesApi';
import { ResourceGroupsItem } from './ResourceGroupsItem';
import { ResourceGroupsItemCache } from './ResourceGroupsItemCache';

export class BranchDataItem implements ResourceGroupsItem {
    constructor(
        private readonly branchItem: ResourceModelBase,
        private readonly branchDataProvider: BranchDataProvider<ApplicationResource, ResourceModelBase>,
        private readonly itemCache: ResourceGroupsItemCache) {
        itemCache.addBranchItem(this.branchItem, this);
    }

    async getChildren(): Promise<ResourceGroupsItem[] | undefined> {
        const children = await this.branchDataProvider.getChildren(this.branchItem);

        const factory = createBranchDataItemFactory(this.itemCache);

        return children?.map(child => factory(child, this.branchDataProvider));
    }

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return this.branchDataProvider.getTreeItem(this.branchItem);
    }

    id: string;
    name: string;
    type: string;
}

export type BranchDataItemFactory = (branchItem: ResourceModelBase, branchDataProvider: BranchDataProvider<ApplicationResource, ResourceModelBase>) => BranchDataItem;

export function createBranchDataItemFactory(itemCache: ResourceGroupsItemCache): BranchDataItemFactory {
    return (branchItem, branchDataProvider) => new BranchDataItem(branchItem, branchDataProvider, itemCache);
}
