/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Wrapper } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ApplicationResource, BranchDataProvider, ResourceBase, ResourceModelBase } from '../../api/v2/v2AzureResourcesApi';
import { ResourceGroupsItem } from './ResourceGroupsItem';
import { ResourceGroupsItemCache } from './ResourceGroupsItemCache';

export type BranchDataItemOptions = {
    defaults?: vscode.TreeItem;
};

export class BranchDataProviderItem implements ResourceGroupsItem, Wrapper {
    constructor(
        private readonly branchItem: ResourceModelBase,
        private readonly branchDataProvider: BranchDataProvider<ResourceBase, ResourceModelBase>,
        private readonly itemCache: ResourceGroupsItemCache,
        private readonly options?: BranchDataItemOptions) {
        itemCache.addBranchItem(this.branchItem, this);
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

    /** Needed for tree item picker PickAppResourceStep */
    public get resource(): ApplicationResource | undefined {
        return (this.branchItem as { resource?: ApplicationResource }).resource;
    }

    unwrap<T>(): T {
        return this.branchItem as T;
    }

    id: string;
    name: string;
    type: string;
}

export type BranchDataItemFactory = (branchItem: ResourceModelBase, branchDataProvider: BranchDataProvider<ResourceBase, ResourceModelBase>, options?: BranchDataItemOptions) => BranchDataProviderItem;

export function createBranchDataItemFactory(itemCache: ResourceGroupsItemCache): BranchDataItemFactory {
    return (branchItem, branchDataProvider, options) => new BranchDataProviderItem(branchItem, branchDataProvider, itemCache, options);
}
