/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceGroupsItem } from './ResourceGroupsItem';

export class ResourceGroupsItemCache {
    private readonly branchItemToItemCache: Map<unknown, ResourceGroupsItem> = new Map();
    private readonly itemToBranchItemCache: Map<ResourceGroupsItem, unknown> = new Map();
    private readonly itemToChildrenCache: Map<ResourceGroupsItem, ResourceGroupsItem[]> = new Map();
    private readonly itemToParentCache: Map<ResourceGroupsItem, ResourceGroupsItem> = new Map();

    addBranchItem(branchItem: unknown, item: ResourceGroupsItem): void {
        this.branchItemToItemCache.set(branchItem, item);
        this.itemToBranchItemCache.set(item, branchItem);
    }

    addItem(item: ResourceGroupsItem, children: ResourceGroupsItem[]): void {
        this.itemToChildrenCache.set(item, children);
        children.forEach(child => this.itemToParentCache.set(child, item));
    }

    evictAll(): void {
        this.branchItemToItemCache.clear();
        this.itemToBranchItemCache.clear();
        this.itemToChildrenCache.clear();
        this.itemToParentCache.clear();
    }

    evictItemChildren(item: ResourceGroupsItem): void {
        // Get initial set of children to process...
        const children = this.itemToChildrenCache.get(item);

        if (children) {
            // Remove set (as we modify the set in place)...
            this.itemToChildrenCache.delete(item);

            // Remove each child from the cache...
            while (true) {
                const child = children?.pop();

                // Stop when we're out of children...
                if (!child) {
                    break;
                }

                // Get the children of the current child (i.e. the grandchildren)...
                const grandChildren = this.itemToChildrenCache.get(child);

                // Add any granchildren to the set of children to process...
                grandChildren?.forEach(grandChild => children.push(grandChild));

                //
                // Remove the child from all the caches...
                //

                const branchItem = this.itemToBranchItemCache.get(child);

                if (branchItem) {
                    this.branchItemToItemCache.delete(branchItem);
                }

                this.itemToBranchItemCache.delete(child);
                this.itemToChildrenCache.delete(child);
                this.itemToParentCache.delete(child);
            }
        }
    }

    getItemForBranchItem(branchItem: unknown): ResourceGroupsItem | undefined {
        return this.branchItemToItemCache.get(branchItem);
    }

    getParentForItem(item: ResourceGroupsItem): ResourceGroupsItem | undefined {
        return this.itemToParentCache.get(item);
    }

    updateItemChildren(item: ResourceGroupsItem, children: ResourceGroupsItem[]): void {
        this.itemToChildrenCache.set(item, children);
        children.forEach(child => this.itemToParentCache.set(child, item));
    }
}
