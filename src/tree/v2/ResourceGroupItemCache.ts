import { ResourceGroupItem } from './ResourceGroupItem';

export class ResourceGroupItemCache {
    private readonly cache: Map<ResourceGroupItem, ResourceGroupItem[]> = new Map();
    private readonly branchcache: Map<unknown, ResourceGroupItem> = new Map();

    addBranchItem(branchItem: unknown, item: ResourceGroupItem): void {
        this.branchcache.set(branchItem, item);
    }

    addItem(item: ResourceGroupItem, children: ResourceGroupItem[]): void {
        this.cache.set(item, children);
    }

    evictAll(): void {
        this.branchcache.clear();
        this.cache.clear();
    }

    evictItemChildren(item: ResourceGroupItem): void {
        // TODO: Evict any branch items associated with this item.

        const children = this.cache.get(item);

        while (children?.pop()) {
            const children = this.cache.get(item);

            children?.forEach(child => children.push(child));

            this.cache.delete(item);
        }
    }

    getItemForBranchItem(branchItem: unknown): ResourceGroupItem | undefined {
        return this.branchcache.get(branchItem);
    }

    updateItemChildren(item: ResourceGroupItem, children: ResourceGroupItem[]): void {
        this.cache.set(item, children);
    }
}
