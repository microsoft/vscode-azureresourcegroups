/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceModelBase } from 'api/src/resources/base';
import { ResourceGroupsItem } from './ResourceGroupsItem';

export class BranchDataItemCache {
    private readonly branchItemToResourceGroupsItemCache: Map<ResourceModelBase, ResourceGroupsItem> = new Map();
    private readonly idToBranchItemCache: Map<string, ResourceModelBase> = new Map();

    addBranchItem(branchItem: ResourceModelBase, item: ResourceGroupsItem): void {
        this.branchItemToResourceGroupsItemCache.set(branchItem, item);
        if (branchItem.id) {
            this.idToBranchItemCache.set(branchItem.id, branchItem);
        }
    }

    clear(): void {
        this.branchItemToResourceGroupsItemCache.clear();
        this.idToBranchItemCache.clear();
    }

    getItemForBranchItem(branchItem: ResourceModelBase): ResourceGroupsItem | undefined {
        return this.branchItemToResourceGroupsItemCache.get(branchItem);
    }

    getItemForId(id?: string): ResourceGroupsItem | undefined {
        if (!id) {
            return undefined;
        }
        const branchItem = this.idToBranchItemCache.get(id);
        return branchItem ? this.branchItemToResourceGroupsItemCache.get(branchItem) : undefined;
    }
}
