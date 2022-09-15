import { Wrapper } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ApplicationResource, BranchDataProvider, ResourceModelBase } from '../../api/v2/v2AzureResourcesApi';
import { createBranchDataItemFactory } from './factories/branchDataItemFactory';
import { ResourceGroupsItem } from './ResourceGroupsItem';
import { ResourceGroupsItemCache } from './ResourceGroupsItemCache';

export type BranchDataItemOptions = {
    defaults?: vscode.TreeItem;
};

export class BranchDataItem implements ResourceGroupsItem, Wrapper {
    constructor(
        protected readonly branchItem: ResourceModelBase,
        protected readonly branchDataProvider: BranchDataProvider<ApplicationResource, ResourceModelBase>,
        protected readonly itemCache: ResourceGroupsItemCache,
        protected readonly options: BranchDataItemOptions | undefined) {
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

    public get quickPickOptions(): { readonly contextValues: string[]; readonly isLeaf: boolean; } {
        return this.branchItem.quickPickOptions ?? {
            contextValues: [],
            isLeaf: true,
        };
    }

    id: string;
    name: string;
    type: string;
}
