import * as vscode from 'vscode';
import { ApplicationResource, BranchDataProvider, ResourceModelBase } from '../../api/v2/v2AzureResourcesApi';
import { ResourceGroupItem } from './ResourceGroupItem';
import { ResourceGroupItemCache } from './ResourceGroupItemCache';

export class BranchDataItem implements ResourceGroupItem {
    constructor(
        private readonly branchItem: ResourceModelBase,
        private readonly branchDataProvider: BranchDataProvider<ApplicationResource, ResourceModelBase>,
        private readonly itemCache: ResourceGroupItemCache) {
        itemCache.addBranchItem(this.branchItem, this);
    }

    async getChildren(): Promise<ResourceGroupItem[] | undefined> {
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

export function createBranchDataItemFactory(itemCache: ResourceGroupItemCache): BranchDataItemFactory {
    return (branchItem, branchDataProvider) => new BranchDataItem(branchItem, branchDataProvider, itemCache);
}
