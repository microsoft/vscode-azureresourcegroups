/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceGroupsItem } from './ResourceGroupsItem';

export class BranchDataItemCache {
    private readonly branchItemToResourceGroupsItemCache: Map<unknown, ResourceGroupsItem> = new Map();

    addBranchItem(branchItem: unknown, item: ResourceGroupsItem): void {
        this.branchItemToResourceGroupsItemCache.set(branchItem, item);
    }

    clear(): void {
        this.branchItemToResourceGroupsItemCache.clear();
    }

    getItemForBranchItem(branchItem: unknown): ResourceGroupsItem | undefined {
        return this.branchItemToResourceGroupsItemCache.get(branchItem);
    }
}
