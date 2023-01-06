/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureResource, BranchDataProvider, ResourceBase, ResourceModelBase } from '@microsoft/vscode-azext-utils/hostapi.v2';
import { FileChangeType, TreeItem } from 'vscode';
import { ResourceTags } from '../../../commands/tags/TagFileSystem';
import { ext } from '../../../extensionVariables';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { BranchDataItemOptions, BranchDataItemWrapper } from '../BranchDataProviderItem';
import { ResourceGroupsItem } from '../ResourceGroupsItem';

export class AzureResourceItem<T extends AzureResource> extends BranchDataItemWrapper {
    constructor(
        public readonly resource: T,
        branchItem: ResourceModelBase,
        branchDataProvider: BranchDataProvider<ResourceBase, ResourceModelBase>,
        itemCache: BranchDataItemCache,
        private readonly parent?: ResourceGroupsItem,
        options?: BranchDataItemOptions) {
        super(branchItem, branchDataProvider, itemCache, options);

        ext.tagFS.fireSoon({ type: FileChangeType.Changed, item: this.tagsModel });
    }

    readonly id = this.resource.id;
    readonly tagsModel = new ResourceTags(this.resource);

    override async getParent(): Promise<ResourceGroupsItem | undefined> {
        return this.parent;
    }

    override async getTreeItem(): Promise<TreeItem> {
        const treeItem = await super.getTreeItem();
        treeItem.id = this.id;
        return treeItem;
    }

    protected override getExtraContextValues(): string[] {
        const values = super.getExtraContextValues();

        if (this.resource.resourceType) {
            values.push(this.resource.resourceType);
        }

        return values;
    }
}

export type ResourceItemFactory<T extends AzureResource> = (resource: T, branchItem: ResourceModelBase, branchDataProvider: BranchDataProvider<ResourceBase, ResourceModelBase>, parent?: ResourceGroupsItem, options?: BranchDataItemOptions) => AzureResourceItem<T>;

export function createResourceItemFactory<T extends AzureResource>(itemCache: BranchDataItemCache): ResourceItemFactory<T> {
    return (resource, branchItem, branchDataProvider, parent, options) => new AzureResourceItem(resource, branchItem, branchDataProvider, itemCache, parent, options);
}
