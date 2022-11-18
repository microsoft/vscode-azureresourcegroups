/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BranchDataProvider, ResourceBase, ResourceModelBase } from '../../../api/v2/v2AzureResourcesApi';
import { BranchDataItemOptions, BranchDataProviderItem } from '../BranchDataProviderItem';
import { ResourceGroupsItemCache } from '../ResourceGroupsItemCache';

export class ApplicationResourceItem<T extends ResourceBase> extends BranchDataProviderItem {
    constructor(
        public readonly resource: T,
        branchItem: ResourceModelBase,
        branchDataProvider: BranchDataProvider<ResourceBase, ResourceModelBase>,
        itemCache: ResourceGroupsItemCache,
        options?: BranchDataItemOptions) {
        super(branchItem, branchDataProvider, itemCache, options);
    }
}

export type ResourceItemFactory<T extends ResourceBase> = (resource: T, branchItem: ResourceModelBase, branchDataProvider: BranchDataProvider<ResourceBase, ResourceModelBase>, options?: BranchDataItemOptions) => ApplicationResourceItem<T>;

export function createResourceItemFactory<T extends ResourceBase>(itemCache: ResourceGroupsItemCache): ResourceItemFactory<T> {
    return (resource, branchItem, branchDataProvider, options) => new ApplicationResourceItem(resource, branchItem, branchDataProvider, itemCache, options);
}
