/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceGroupsItem } from './ResourceGroupsItem';

export class BranchDataItemCache {
    private readonly branchItemToItemCache: Map<unknown, ResourceGroupsItem> = new Map();

    addBranchItem(branchItem: unknown, item: ResourceGroupsItem): void {
        this.branchItemToItemCache.set(branchItem, item);
    }

    evictAll(): void {
        this.branchItemToItemCache.clear();
    }

    getItemForBranchItem(branchItem: unknown): ResourceGroupsItem | undefined {
        return this.branchItemToItemCache.get(branchItem);
    }
}
