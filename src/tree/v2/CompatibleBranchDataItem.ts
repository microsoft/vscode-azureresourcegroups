import * as vscode from 'vscode';
import { ApplicationResource, BranchDataProvider, ResourceModelBase } from '../../api/v2/v2AzureResourcesApi';
import { BranchDataItem, BranchDataItemOptions } from './BranchDataItem';
import { createBranchDataItemFactory } from './factories/branchDataItemFactory';
import { ResourceGroupsItem } from './ResourceGroupsItem';
import { ResourceGroupsItemCache } from './ResourceGroupsItemCache';

export class CompatibleBranchDataItem extends BranchDataItem {
    constructor(
        branchItem: ResourceModelBase,
        branchDataProvider: BranchDataProvider<ApplicationResource, ResourceModelBase>,
        itemCache: ResourceGroupsItemCache,
        options: BranchDataItemOptions | undefined
    ) {
        super(branchItem, branchDataProvider, itemCache, options);
        itemCache.addBranchItem(this.branchItem, this);
    }

    /** Needed for tree item picker PickAppResourceStep */
    public get resource(): ApplicationResource | undefined {
        return (this.branchItem as { resource?: ApplicationResource }).resource;
    }

    async getChildren(): Promise<ResourceGroupsItem[] | undefined> {
        const children = await this.branchDataProvider.getChildren(this.branchItem);
        const factory = createBranchDataItemFactory(this.itemCache);
        return children?.map(child => factory(child, this.branchDataProvider));
    }

    async getTreeItem(): Promise<vscode.TreeItem> {
        const treeItem = await this.branchDataProvider.getTreeItem(this.branchItem);

        return {
            ...this.options?.defaults ?? {},
            ...treeItem
        }
    }

    unwrap<T>(): T {
        return this.branchItem as T;
    }

    id: string;
    name: string;
    type: string;
}
