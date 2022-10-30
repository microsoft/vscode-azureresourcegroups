/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ResourceBase, ResourceModelBase } from '../../api/v2/v2AzureResourcesApi';
import { ResourceGroupsItem } from './ResourceGroupsItem';
import { ResourceGroupsItemCache } from './ResourceGroupsItemCache';

export abstract class ResourceTreeDataProviderBase extends vscode.Disposable implements vscode.TreeDataProvider<ResourceGroupsItem> {
    private readonly branchTreeDataChangeSubscription: vscode.Disposable;
    private readonly refreshSubscription: vscode.Disposable;
    private readonly resourceProviderManagerListener: vscode.Disposable;
    protected readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>();

    public lockCache: boolean = false;

    constructor(
        protected readonly itemCache: ResourceGroupsItemCache,
        onDidChangeBranchTreeData: vscode.Event<void | ResourceModelBase | ResourceModelBase[] | null | undefined>,
        onDidChangeResource: vscode.Event<ResourceBase | undefined>,
        onRefresh: vscode.Event<void>,
        callOnDispose?: () => void) {
        super(
            () => {
                callOnDispose?.();

                this.branchTreeDataChangeSubscription.dispose();
                this.refreshSubscription.dispose();
                this.resourceProviderManagerListener.dispose();
            });

        this.branchTreeDataChangeSubscription = onDidChangeBranchTreeData(
            (e: void | ResourceModelBase | ResourceModelBase[] | null | undefined) => {
                const rgItems: ResourceGroupsItem[] = [];

                // eslint-disable-next-line no-extra-boolean-cast
                if (!!e) {
                    // e was defined, either a single item or array
                    // Make an array for consistency
                    const branchItems: unknown[] = Array.isArray(e) ? e : [e];

                    for (const branchItem of branchItems) {
                        const rgItem = this.itemCache.getItemForBranchItem(branchItem);

                        if (rgItem) {
                            rgItems.push(rgItem);
                        }
                    }

                    if (!this.lockCache) {
                        this.onDidChangeTreeDataEmitter.fire(rgItems);
                    }

                } else {
                    // e was null/undefined/void
                    // Translate it to fire on all elements for this branch data provider
                    // TODO

                    if (!this.lockCache) {
                        this.onDidChangeTreeDataEmitter.fire();
                    }
                }
            });

        this.refreshSubscription = onRefresh(() => {
            if (!this.lockCache) {
                this.onDidChangeTreeDataEmitter.fire()
            }
        });

        // TODO: If only individual resources change, just update the tree related to those resources.
        this.resourceProviderManagerListener = onDidChangeResource(() => {
            if (!this.lockCache) {
                this.onDidChangeTreeDataEmitter.fire()
            }
        });

        this.onDidChangeTreeData((e) => {
            console.log('onDidChangeTreeData', e, this.lockCache);
        });
    }

    onDidChangeTreeData: vscode.Event<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined> = this.onDidChangeTreeDataEmitter.event;

    async getTreeItem(element: ResourceGroupsItem): Promise<vscode.TreeItem> {

        let item = this.itemCache.getItemForBranchItem(element) ?? element;

        if (!item.getTreeItem) {
            item = (await this.findItem(element.fullId))!;
        }

        const t = await item.getTreeItem();
        // incorrectly changing t.id to '/test'. Cache doesn't have parent
        t.id = this.itemCache.getId(item);
        t.tooltip = t.id;
        return t;
    }

    async getChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined> {
        return this.cacheGetChildren(element, () => this.onGetChildren(element), this.itemCache);
    }

    private async cacheGetChildren(element: ResourceGroupsItem | undefined, getChildren: () => Promise<ResourceGroupsItem[] | null | undefined>, cache: ResourceGroupsItemCache) {
        if (element) {
            // TODO: Do we really need to evict before generating new children, or can we just update after the fact?
            //       Since the callback is async, could change notifications show up while doing this?
            // Don't do this, it breaks reveal a lot
            // cache.evictItemChildren(element);
        } else {
            // this is being called while VS Code is processing a reveal call, making the reveal fail
            if (!this.lockCache) {
                cache.evictAll();
            }
        }

        const children = await getChildren();

        if (children) {
            if (element) {
                cache.updateItemChildren(element, children);
            } else {
                children.forEach(child => cache.addRootItem(child, []));
            }
        }

        return children;
    }

    getParent(element: ResourceGroupsItem): ResourceGroupsItem | undefined {
        return this.itemCache.getParentForItem(element);
    }

    // setting to true makes reveal work
    public async findItem(id: string, useGlobalCache: boolean = true): Promise<ResourceGroupsItem | undefined> {
        const itemCache = useGlobalCache ? this.itemCache : new ResourceGroupsItemCache();
        let element: ResourceGroupsItem | undefined = undefined;

        outerLoop: while (true) {

            const cachedChildren = itemCache.getChildrenForItem(element);
            const children: ResourceGroupsItem[] | null | undefined = cachedChildren?.length ? cachedChildren : await this.cacheGetChildren(element, () => this.onGetChildren(element), itemCache);

            if (!children) {
                return;
            }

            for (const child of children) {
                if (itemCache.getId(child) === id) {
                    return child;
                } else if (itemCache.isAncestorOf(child, id)) {
                    element = child;
                    continue outerLoop;
                }
            }

            return undefined;
        }
    }

    protected abstract onGetChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined>;
}
