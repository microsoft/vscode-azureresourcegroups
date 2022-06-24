import { ResourceGroupResourceBase } from './ResourceGroupResourceBase';

export class ResourceGroupItemCache {
    private readonly cache: Map<ResourceGroupResourceBase, ResourceGroupResourceBase[]> = new Map();
    private readonly branchcache: Map<unknown, ResourceGroupResourceBase> = new Map();

    addBranchItem(branchItem: unknown, item: ResourceGroupResourceBase): void {
        this.branchcache.set(branchItem, item);
    }

    addItem(item: ResourceGroupResourceBase, children: ResourceGroupResourceBase[]): void {
        this.cache.set(item, children);
    }

    evictAll(): void {
        this.branchcache.clear();
        this.cache.clear();
    }

    evictItem(item: ResourceGroupResourceBase): void {
        // TODO: Evict any branch items associated with this item.

        const stack = [ item ];

        while (stack.pop()) {
            const children = this.cache.get(item);

            children?.forEach(child => stack.push(child));

            this.cache.delete(item);
        }
    }

    getItemForBranchItem(branchItem: unknown): ResourceGroupResourceBase | undefined {
        return this.branchcache.get(branchItem);
    }
}
