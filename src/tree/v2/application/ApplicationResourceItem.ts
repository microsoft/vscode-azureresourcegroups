/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeItem } from 'vscode';
import { BranchDataProvider, ResourceBase, ResourceModelBase } from '../../../api/v2/v2AzureResourcesApi';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { BranchDataItemOptions, BranchDataProviderItem } from '../BranchDataProviderItem';
import { ResourceGroupsItem } from '../ResourceGroupsItem';

export class ApplicationResourceItem<T extends ResourceBase> extends BranchDataProviderItem {
    constructor(
        private readonly parent: ResourceGroupsItem,
        public readonly resource: T,
        branchItem: ResourceModelBase,
        branchDataProvider: BranchDataProvider<ResourceBase, ResourceModelBase>,
        itemCache: BranchDataItemCache,
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

export type ResourceItemFactory<T extends ResourceBase> = (parent: ResourceGroupsItem, resource: T, branchItem: ResourceModelBase, branchDataProvider: BranchDataProvider<ResourceBase, ResourceModelBase>, options?: BranchDataItemOptions) => ApplicationResourceItem<T>;

export function createResourceItemFactory<T extends ResourceBase>(itemCache: BranchDataItemCache): ResourceItemFactory<T> {
    return (parent, resource, branchItem, branchDataProvider, options) => new ApplicationResourceItem(parent, resource, branchItem, branchDataProvider, itemCache, options);
}
