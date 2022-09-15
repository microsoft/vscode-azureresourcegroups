import { AzExtParentTreeItem, AzExtTreeItem, CompatibleContextValueFilterableTreeNode, CompatibleQuickPickOptions } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ApplicationResource, Box, BranchDataProvider, ResourceModelBase } from '../../api/v2/v2AzureResourcesApi';
import { BranchDataItemOptions, createBranchDataItemFactory } from './BranchDataItem';
import { ResourceGroupsItem } from './ResourceGroupsItem';
import { ResourceGroupsItemCache } from './ResourceGroupsItemCache';

export class CompatibleBranchDataItem implements ResourceGroupsItem, Box, CompatibleContextValueFilterableTreeNode {
    constructor(
        private readonly branchItem: ResourceModelBase,
        private readonly branchDataProvider: BranchDataProvider<ApplicationResource, ResourceModelBase>,
        private readonly itemCache: ResourceGroupsItemCache,
        private readonly options: BranchDataItemOptions | undefined
    ) {
        itemCache.addBranchItem(this.branchItem, this);
    }

    /**
     * Needed for tree item picker PickAppResourceStep.
     * This should only be defined for application resources.
     *
     * _TODO:_ Should this go somewhere else since it's only defined for application resources?
     */
    public get resource(): ApplicationResource | undefined {
        return (this.branchItem as { resource?: ApplicationResource }).resource;
    }

    async getChildren(): Promise<ResourceGroupsItem[] | undefined> {
        const children = await this.branchDataProvider.getChildren(this.branchItem);

        const factory = createBranchDataItemFactory(this.itemCache);

        return children?.map(child => factory(child, this.branchDataProvider));
    }

    public get quickPickOptions(): CompatibleQuickPickOptions {
        const ti = this.branchItem as AzExtTreeItem;

        const maybeParent = ti as AzExtParentTreeItem;

        const createChild = maybeParent.createChild ? {
            callback: maybeParent.createChild.bind(maybeParent) as typeof maybeParent.createChild,
            label: maybeParent.createNewLabel ?? maybeParent.childTypeLabel ? `$(plus) Create new ${maybeParent.childTypeLabel}` : undefined
        } : undefined

        return {
            contextValues: ti.contextValue.split(';'),
            isLeaf: !maybeParent?.loadMoreChildrenImpl,
            createChild,
        }
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
