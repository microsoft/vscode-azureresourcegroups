/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { BranchDataProvider, ResourceBase, ResourceModelBase, WrappedResourceModel } from '../../api/v2/v2AzureResourcesApi';
import { ResourceGroupsItem } from './ResourceGroupsItem';
import { ResourceGroupsItemCache } from './ResourceGroupsItemCache';

export type BranchDataItemOptions = {
    defaultId?: string;
    defaults?: vscode.TreeItem;
};

export class BranchDataProviderItem implements ResourceGroupsItem, WrappedResourceModel {
    constructor(
        private readonly branchItem: ResourceModelBase,
        private readonly branchDataProvider: BranchDataProvider<ResourceBase, ResourceModelBase>,
        private readonly itemCache: ResourceGroupsItemCache,
        private readonly options?: BranchDataItemOptions) {
        itemCache.addBranchItem(this.branchItem, this);
    }

    readonly id: string = this.branchItem.id ?? this?.options?.defaultId ?? randomUUID();

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

    unwrap<T extends ResourceModelBase>(): T | undefined {
        return this.branchItem as T;
    }
}

export type BranchDataItemFactory = (branchItem: ResourceModelBase, branchDataProvider: BranchDataProvider<ResourceBase, ResourceModelBase>, options?: BranchDataItemOptions) => BranchDataProviderItem;

export function createBranchDataItemFactory(itemCache: ResourceGroupsItemCache): BranchDataItemFactory {
    return (branchItem, branchDataProvider, options) => new BranchDataProviderItem(branchItem, branchDataProvider, itemCache, options);
}
