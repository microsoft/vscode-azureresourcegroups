/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeItem } from 'vscode';
import { BranchDataProvider, ResourceBase, ResourceModelBase } from '../../../api/v2/v2AzureResourcesApi';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { BranchDataItemOptions, BranchDataProviderItem } from '../BranchDataProviderItem';
import { ResourceGroupsItem } from '../ResourceGroupsItem';

export class AzureResourceItem<T extends ResourceBase> extends BranchDataProviderItem {
    constructor(
        public readonly resource: T,
        branchItem: ResourceModelBase,
        branchDataProvider: BranchDataProvider<ResourceBase, ResourceModelBase>,
        itemCache: BranchDataItemCache,
        private readonly parent?: ResourceGroupsItem,
        options?: BranchDataItemOptions) {
        super(branchItem, branchDataProvider, itemCache, options);
    }

    readonly id = this.resource.id;

    override async getParent(): Promise<ResourceGroupsItem | undefined> {
        return this.parent;
    }

    override async getTreeItem(): Promise<TreeItem> {
        const treeItem = await super.getTreeItem();
        treeItem.id = this.id;
        return treeItem;
    }
}

export type ResourceItemFactory<T extends ResourceBase> = (resource: T, branchItem: ResourceModelBase, branchDataProvider: BranchDataProvider<ResourceBase, ResourceModelBase>, parent?: ResourceGroupsItem, options?: BranchDataItemOptions) => AzureResourceItem<T>;

export function createResourceItemFactory<T extends ResourceBase>(itemCache: BranchDataItemCache): ResourceItemFactory<T> {
    return (resource, branchItem, branchDataProvider, parent, options) => new AzureResourceItem(resource, branchItem, branchDataProvider, itemCache, parent, options);
}
