/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { CancellationToken, Event, ProviderResult, TreeItem } from "vscode";
import { BranchDataProvider, ResourceBase, ResourceModelBase } from "../../api/v2/v2AzureResourcesApi";

type BranchDataProviderBase = BranchDataProvider<ResourceBase, ResourceModelBase>;

type CachedResourceModelBase = ResourceModelBase & {
    _rgApiCachedParent?: CachedResourceModelBase;
}

/**
 * Wraps a `BranchDataProvider` adding the following:
 *
 * - Implements `getParent` by caching calls to `getChildren`.
 * - in `getTreeItem`, `TreeItem.id` is set to a path based id
 */
export class CachedBranchDataProvider<TBranchDataProvider extends BranchDataProviderBase> implements BranchDataProviderBase {
    constructor(private readonly branchDataProvider: TBranchDataProvider) { }

    async getChildren(element: ResourceModelBase): Promise<ResourceModelBase[] | null | undefined> {
        const children = await this.branchDataProvider.getChildren(element);

        if (children) {
            return this.updateItemChildren(element, children);
        }

        return children;
    }

    getParent(element: CachedResourceModelBase): ProviderResult<ResourceModelBase> {
        return element._rgApiCachedParent;
    }

    getResourceItem(element: ResourceBase): ResourceModelBase | Thenable<ResourceModelBase> {
        return this.branchDataProvider.getResourceItem(element);
    }

    onDidChangeTreeData: Event<void | ResourceModelBase | ResourceModelBase[] | null | undefined> | undefined = this.branchDataProvider.onDidChangeTreeData;

    async getTreeItem(element: ResourceModelBase): Promise<TreeItem> {
        const treeItem = await this.branchDataProvider.getTreeItem(element);
        treeItem.id = this.getId(element);
        return treeItem;
    }

    resolveTreeItem(item: TreeItem, element: ResourceModelBase, token: CancellationToken): ProviderResult<TreeItem> {
        return this.branchDataProvider.resolveTreeItem?.(item, element, token);
    }

    private getId(element: CachedResourceModelBase): string {
        return this.getPathForItem(element).join('/');
    }

    private getPathForItem(item: CachedResourceModelBase): string[] {
        const path: string[] = [];

        let currentItem: CachedResourceModelBase | undefined = item;

        while (currentItem) {
            const nextItem: CachedResourceModelBase | undefined = currentItem._rgApiCachedParent;

            if (currentItem.id) {
                path.push(currentItem.id);
            }

            currentItem = nextItem;
        }

        return path.reverse();
    }

    private updateItemChildren(parent: ResourceModelBase, children: ResourceModelBase[]): CachedResourceModelBase[] {
        (children as CachedResourceModelBase[]).forEach(child => child._rgApiCachedParent = parent);
        return children;
    }
}
