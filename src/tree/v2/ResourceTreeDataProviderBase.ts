/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceBase, ResourceModelBase } from '@microsoft/vscode-azext-utils/hostapi.v2';
import * as vscode from 'vscode';
import { BranchDataItemCache } from './BranchDataItemCache';
import { ResourceGroupsItem } from './ResourceGroupsItem';

export abstract class ResourceTreeDataProviderBase extends vscode.Disposable implements vscode.TreeDataProvider<ResourceGroupsItem> {
    private readonly branchTreeDataChangeSubscription: vscode.Disposable;
    private readonly refreshSubscription: vscode.Disposable;
    private readonly resourceProviderManagerListener: vscode.Disposable;
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>();

    constructor(
        protected readonly itemCache: BranchDataItemCache,
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

    notifyTreeDataChanged(data: void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined): void {
        this.onDidChangeTreeDataEmitter.fire(data);
    }

    async getTreeItem(element: ResourceGroupsItem): Promise<vscode.TreeItem> {
        const treeItem = await element.getTreeItem();
        // TODO: remove this when we're done working with ids
        treeItem.tooltip = treeItem.id;
        return treeItem;
    }

    async getChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined> {
        if (!element) {
            this.itemCache.clear();
        }

        return await this.onGetChildren(element);
    }

    getParent(element: ResourceGroupsItem): vscode.ProviderResult<ResourceGroupsItem> {
        return element.getParent?.();
    }

    async findItemById(id: string): Promise<ResourceGroupsItem | undefined> {
        let element: ResourceGroupsItem | undefined = undefined;

        outerLoop: while (true) {
            const children: ResourceGroupsItem[] | null | undefined = await this.getChildren(element);

            if (!children) {
                return;
            }

            for (const child of children) {
                if (child.id === id) {
                    return child;
                } else if (this.isAncestorOf(child, id)) {
                    element = child;
                    continue outerLoop;
                }
            }

            return undefined;
        }
    }

    protected isAncestorOf(element: ResourceGroupsItem, id: string): boolean {
        return id.startsWith(element.id + '/');
    }

    protected abstract onGetChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined>;
}
