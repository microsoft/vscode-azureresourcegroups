/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureResource, BranchDataProvider, ResourceBase, ResourceModelBase } from '@microsoft/vscode-azext-utils/hostapi.v2';
import { FileChangeType, TreeItem } from 'vscode';
import { EditableTags } from '../../../commands/tags/TagFileSystem';
import { ext } from '../../../extensionVariables';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { BranchDataItemOptions, BranchDataProviderItem } from '../BranchDataProviderItem';
import { ResourceGroupsItem } from '../ResourceGroupsItem';

export class AzureResourceItem<T extends AzureResource> extends BranchDataProviderItem {
    constructor(
        public readonly resource: T,
        branchItem: ResourceModelBase,
        branchDataProvider: BranchDataProvider<ResourceBase, ResourceModelBase>,
        itemCache: BranchDataItemCache,
        private readonly parent?: ResourceGroupsItem,
        options?: BranchDataItemOptions) {
        super(branchItem, branchDataProvider, itemCache, options);

        ext.tagFS.fireSoon({ type: FileChangeType.Changed, item: this.tags });
    }

    readonly id = this.resource.id;

    override async getParent(): Promise<ResourceGroupsItem | undefined> {
        return this.parent;
    }

    tags = new EditableTags(this.resource);

    override async getTreeItem(): Promise<TreeItem> {
        const treeItem = await super.getTreeItem();
        treeItem.id = this.id;
        return treeItem;
    }
}

export type ResourceItemFactory<T extends AzureResource> = (resource: T, branchItem: ResourceModelBase, branchDataProvider: BranchDataProvider<ResourceBase, ResourceModelBase>, parent?: ResourceGroupsItem, options?: BranchDataItemOptions) => AzureResourceItem<T>;

export function createResourceItemFactory<T extends AzureResource>(itemCache: BranchDataItemCache): ResourceItemFactory<T> {
    return (resource, branchItem, branchDataProvider, parent, options) => new AzureResourceItem(resource, branchItem, branchDataProvider, itemCache, parent, options);
}
