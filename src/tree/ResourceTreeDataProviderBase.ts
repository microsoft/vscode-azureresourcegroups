/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, parseError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ResourceBase, ResourceModelBase } from '../../api/src/index';
import { BranchDataItemCache } from './BranchDataItemCache';
import { BranchDataItemWrapper } from './BranchDataItemWrapper';
import { InvalidItem } from './InvalidItem';
import { ResourceGroupsItem } from './ResourceGroupsItem';
import { TreeItemStateStore } from './TreeItemState';

export abstract class ResourceTreeDataProviderBase extends vscode.Disposable implements vscode.TreeDataProvider<ResourceGroupsItem> {
    private readonly branchTreeDataChangeSubscription: vscode.Disposable;
    private readonly refreshSubscription: vscode.Disposable;
    private readonly resourceProviderManagerListener: vscode.Disposable;
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>();

    constructor(
        protected readonly itemCache: BranchDataItemCache,
        onDidChangeBranchTreeData: vscode.Event<void | ResourceModelBase | ResourceModelBase[] | null | undefined>,
        onDidChangeResource: vscode.Event<ResourceBase | undefined>,
        onRefresh: vscode.Event<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>,
        private readonly state?: TreeItemStateStore,
        callOnDispose?: () => void) {
        super(
            () => {
                callOnDispose?.();

                this.branchTreeDataChangeSubscription.dispose();
                this.refreshSubscription.dispose();
                this.resourceProviderManagerListener.dispose();
            });

        this.branchTreeDataChangeSubscription = onDidChangeBranchTreeData(e => this.notifyTreeDataChanged(e));

        this.refreshSubscription = onRefresh((e) => this.onDidChangeTreeDataEmitter.fire(e));

        // TODO: If only individual resources change, just update the tree related to those resources.
        this.resourceProviderManagerListener = onDidChangeResource(() => this.onDidChangeTreeDataEmitter.fire());
    }

    onDidChangeTreeData: vscode.Event<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined> = this.onDidChangeTreeDataEmitter.event;

    notifyTreeDataChanged(data: void | ResourceModelBase | ResourceModelBase[] | null | undefined): void {
        const rgItems: ResourceGroupsItem[] = [];

        // eslint-disable-next-line no-extra-boolean-cast
        if (!!data) {
            // e was defined, either a single item or array
            // Make an array for consistency
            const branchItems: ResourceModelBase[] = Array.isArray(data) ? data : [data];

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
    }

    async getTreeItem(element: ResourceGroupsItem): Promise<vscode.TreeItem> {
        try {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            return (await callWithTelemetryAndErrorHandling('getTreeItem', async (context) => {
                context.errorHandling.rethrow = true;
                return await element.getTreeItem();
            }))!;
        } catch (e) {
            const invalidItem = new InvalidItem(parseError(e));
            return invalidItem.getTreeItem();
        }
    }

    async getChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined> {
        const children = await this.onGetChildren(element);
        return children?.map(child => {
            if (this.state) {
                // don't wrap items that belong to branch data providers
                if (child instanceof BranchDataItemWrapper) {
                    return child;
                }
                return this.state.wrapItemInStateHandling(child, (item) => this.onDidChangeTreeDataEmitter.fire(item));
            }
            return child;
        });
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
                if (child.id.toLowerCase() === id.toLowerCase()) {
                    return child;
                } else if (removePrefix(child.id.toLowerCase()) === id.toLowerCase()) {
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
        // remove accounts / <accountId>/tenant/<tenantId> from the beginning of the id
        const elementId = removePrefix(element.id) + '/';
        return id.toLowerCase().startsWith(elementId.toLowerCase());
    }

    protected abstract onGetChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined>;
}

function removePrefix(id: string): string {
    return id.replace(/\/accounts\/.+\/tenants\/[^/]+\//i, '/')
}
