import { ResourceGroupItem } from './ResourceGroupItem';

export class ResourceGroupItemCache {
    private readonly branchItemToItemCache: Map<unknown, ResourceGroupItem> = new Map();
    private readonly itemToBranchItemCache: Map<ResourceGroupItem, unknown> = new Map();
    private readonly itemToChildrenCache: Map<ResourceGroupItem, ResourceGroupItem[]> = new Map();

    addBranchItem(branchItem: unknown, item: ResourceGroupItem): void {
        this.branchItemToItemCache.set(branchItem, item);
        this.itemToBranchItemCache.set(item, branchItem);
    }

    addItem(item: ResourceGroupItem, children: ResourceGroupItem[]): void {
        this.itemToChildrenCache.set(item, children);
    }

    evictAll(): void {
        this.branchItemToItemCache.clear();
        this.itemToBranchItemCache.clear();
        this.itemToChildrenCache.clear();
    }

    evictItemChildren(item: ResourceGroupItem): void {
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
        }
    }

    getItemForBranchItem(branchItem: unknown): ResourceGroupItem | undefined {
        return this.branchItemToItemCache.get(branchItem);
    }

    updateItemChildren(item: ResourceGroupItem, children: ResourceGroupItem[]): void {
        this.itemToChildrenCache.set(item, children);
    }
}
