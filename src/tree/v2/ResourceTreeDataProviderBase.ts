/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ResourceBase, ResourceModelBase } from '../../api/v2/v2AzureResourcesApi';
import { InternalTreeView } from './createTreeView';
import { ResourceGroupsItem } from './ResourceGroupsItem';
import { ResourceGroupsItemCache } from './ResourceGroupsItemCache';

type RevealOptions = Parameters<vscode.TreeView<ResourceGroupsItem>['reveal']>['1'];

export abstract class ResourceTreeDataProviderBase extends vscode.Disposable implements vscode.TreeDataProvider<ResourceGroupsItem> {
    private readonly branchTreeDataChangeSubscription: vscode.Disposable;
    private readonly refreshSubscription: vscode.Disposable;
    private readonly resourceProviderManagerListener: vscode.Disposable;
    private readonly onDidChangeTreeDataEmitterListener: vscode.Disposable;

    protected readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>();

    private isRevealing: boolean = false;
    private readonly onDidChangeTreeDataEventQueue: Set<(void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined)> = new Set();

    readonly onDidChangeTreeData: vscode.Event<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>;

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
                this.onDidChangeTreeDataEmitterListener.dispose();
            });

        const gatedOnDidChangeTreeDataEmitter = new vscode.EventEmitter<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>();
        this.onDidChangeTreeData = gatedOnDidChangeTreeDataEmitter.event;

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
                    this.onDidChangeTreeDataEmitter.fire(rgItems);
                } else {
                    // e was null/undefined/void
                    // Translate it to fire on all elements for this branch data provider
                    // TODO
                    this.onDidChangeTreeDataEmitter.fire();
                }
            });

        this.refreshSubscription = onRefresh(() => this.onDidChangeTreeDataEmitter.fire());

        // TODO: If only individual resources change, just update the tree related to those resources.
        this.resourceProviderManagerListener = onDidChangeResource(() => this.onDidChangeTreeDataEmitter.fire());

        this.onDidChangeTreeDataEmitterListener = this.onDidChangeTreeDataEmitter.event((e) => {
            if (!this.isRevealing) {
                gatedOnDidChangeTreeDataEmitter.fire(e);
            } else {
                this.onDidChangeTreeDataEventQueue.add(e);
            }
        });
    }

    async getTreeItem(element: ResourceGroupsItem): Promise<vscode.TreeItem> {
        const t = await element.getTreeItem();
        t.id = this.itemCache.getId(element);
        t.tooltip = t.id;
        return t;
    }

    async getChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined> {
        return this.cacheGetChildren(element, () => this.onGetChildren(element));
    }

    getParent(element: ResourceGroupsItem): ResourceGroupsItem | undefined {
        return this.itemCache.getParentForItem(element);
    }

    /**
     * Calls `TreeView.reveal` and while executing:
     * - Defers firing `onDidChangeTreeData` events
     */
    async reveal(treeView: InternalTreeView, element: ResourceGroupsItem, options?: RevealOptions): Promise<void> {
        try {
            this.isRevealing = true;
            await treeView._reveal(element, options);
        } finally {
            this.isRevealing = false;
            this.onDidChangeTreeDataEventQueue.forEach(e => this.onDidChangeTreeDataEmitter.fire(e));
            this.onDidChangeTreeDataEventQueue.clear();
        }
    }

    async findItem(id: string): Promise<ResourceGroupsItem | undefined> {
        let element: ResourceGroupsItem | undefined = undefined;

        outerLoop: while (true) {
            const cachedChildren = this.itemCache.getChildrenForItem(element);
            const children: ResourceGroupsItem[] | null | undefined = cachedChildren?.length ? cachedChildren : await this.getChildren(element);

            if (!children) {
                return;
            }

            for (const child of children) {
                if (this.itemCache.getId(child) === id) {
                    return child;
                } else if (this.itemCache.isAncestorOf(child, id)) {
                    element = child;
                    continue outerLoop;
                }
            }

            return undefined;
        }
    }

    protected abstract onGetChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined>;

    private async cacheGetChildren(element: ResourceGroupsItem | undefined, getChildren: () => Promise<ResourceGroupsItem[] | null | undefined>): Promise<ResourceGroupsItem[] | null | undefined> {
        const children: ResourceGroupsItem[] | undefined | null = await getChildren();

        if (!element) {
            this.itemCache.evictAll();
        }

        if (children) {
            if (element) {
                this.itemCache.updateItemChildren(element, children);
            } else {
                children.forEach(child => this.itemCache.addRootItem(child, []));
            }
        }

        return children;
    }
}
