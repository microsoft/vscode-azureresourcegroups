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
                    this.onDidChangeTreeDataEmitter.fire(rgItems)
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
    }

    onDidChangeTreeData: vscode.Event<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined> = this.onDidChangeTreeDataEmitter.event;

    getTreeItem(element: ResourceGroupsItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }

    async getChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined> {
        if (element) {
            // TODO: Do we really need to evict before generating new children, or can we just update after the fact?
            //       Since the callback is async, could change notifications show up while doing this?
            this.itemCache.evictItemChildren(element);
        } else {
            this.itemCache.evictAll();
        }

        const children = await this.onGetChildren(element);

        if (children) {
            if (element) {
                this.itemCache.updateItemChildren(element, children);
            } else {
                children.forEach(child => this.itemCache.addRootItem(child, []));
            }
        }

        return children;
    }

    getParent(element: ResourceGroupsItem): vscode.ProviderResult<ResourceGroupsItem> {
        return element.getParent?.();
    }

    protected abstract onGetChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined>;
}
