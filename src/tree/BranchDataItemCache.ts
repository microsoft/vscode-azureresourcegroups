/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceModelBase } from 'api/src/resources/base';
import { BranchDataItemWrapper } from './BranchDataItemWrapper';
import { ResourceGroupsItem } from './ResourceGroupsItem';

export class BranchDataItemCache {
    private readonly branchItemToResourceGroupsItemCache: Map<ResourceModelBase, ResourceGroupsItem> = new Map();
    private readonly idToBranchItemCache: Map<string, ResourceModelBase> = new Map();

    addBranchItem(branchItem: ResourceModelBase, item: ResourceGroupsItem): void {
        this.branchItemToResourceGroupsItemCache.set(branchItem, item);
        const id = this.getIdForBranchItem(branchItem);
        if (id) {
            this.idToBranchItemCache.set(id, branchItem);
        }
    }

    clear(): void {
        this.branchItemToResourceGroupsItemCache.clear();
        this.idToBranchItemCache.clear();
    }

    getItemForBranchItem(branchItem: ResourceModelBase): ResourceGroupsItem | undefined {
        return this.branchItemToResourceGroupsItemCache.get(branchItem);
    }

    getItemForBranchItemById(id: string): ResourceGroupsItem | undefined {
        const cachedBranchItem = this.idToBranchItemCache.get(id);
        return cachedBranchItem ? this.branchItemToResourceGroupsItemCache.get(cachedBranchItem) : undefined;
    }

    createOrGetItem<T extends BranchDataItemWrapper>(branchItem: ResourceModelBase, createItem: () => T, id: string): T {
        const itemId = id ?? this.getIdForBranchItem(branchItem);
        const cachedItem = this.getItemForBranchItemById(itemId) as T | undefined;
        if (cachedItem) {
            cachedItem.branchItem = branchItem;
            this.addBranchItem(branchItem, cachedItem);
            return cachedItem;
        }
        return createItem();
    }

    private getIdForBranchItem(branchItem: ResourceModelBase): string | undefined {
        return branchItem.id;
    }
}
