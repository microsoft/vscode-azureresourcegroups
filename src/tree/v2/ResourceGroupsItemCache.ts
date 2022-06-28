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
        const children = this.itemToChildrenCache.get(item);

        while (children?.pop()) {
            const children = this.itemToChildrenCache.get(item);

            children?.forEach(child => children.push(child));

            const branchItem = this.itemToBranchItemCache.get(item);

            if (branchItem) {
                this.branchItemToItemCache.delete(branchItem);
            }

            this.itemToBranchItemCache.delete(item);
            this.itemToChildrenCache.delete(item);
            this.itemToParentCache.delete(item);
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
