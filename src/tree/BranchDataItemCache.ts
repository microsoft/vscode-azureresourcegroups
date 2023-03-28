/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceModelBase } from 'api/src/resources/base';
import { ResourceGroupsItem } from './ResourceGroupsItem';

export class BranchDataItemCache {
    private readonly branchItemToResourceGroupsItemCache: Map<ResourceModelBase, ResourceGroupsItem> = new Map();

    addBranchItem(branchItem: ResourceModelBase, item: ResourceGroupsItem): void {
        this.branchItemToResourceGroupsItemCache.set(branchItem, item);
    }

    clear(): void {
        this.branchItemToResourceGroupsItemCache.clear();
    }

    getItemForBranchItem(branchItem: ResourceModelBase): ResourceGroupsItem | undefined {
        return this.branchItemToResourceGroupsItemCache.get(branchItem);
    }

    getItemForId(id?: string): ResourceGroupsItem | undefined {
        if (!id) {
            return undefined;
        }
        for (const [key, value] of this.branchItemToResourceGroupsItemCache.entries()) {
            if (key.id === id) {
                return value;
            }
        }
        return undefined;
    }
}
