/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FileChangeType, TreeItem, Uri } from 'vscode';
import { AzureResource, BranchDataProvider, ResourceBase, ResourceModelBase } from '../../../api/src/index';
import { ResourceTags } from '../../commands/tags/TagFileSystem';
import { ext } from '../../extensionVariables';
import { createPortalUrl } from '../../utils/v2/createPortalUrl';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { BranchDataItemOptions, BranchDataItemWrapper } from '../BranchDataItemWrapper';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { getAccountAndTenantPrefix } from './idPrefix';

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
        this.portalUrl = createPortalUrl(resource.subscription, resource.id);
    }

    override readonly portalUrl: Uri;
    readonly id = `${getAccountAndTenantPrefix(this.resource.subscription)}${this.resource.id}`;
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
    return (resource, branchItem, branchDataProvider, parent, options) =>
        itemCache.createOrGetItem(
            branchItem,
            () => new AzureResourceItem(resource, branchItem, branchDataProvider, itemCache, parent, options),
            `${getAccountAndTenantPrefix(resource.subscription)}${resource.id}`,
        );
}
