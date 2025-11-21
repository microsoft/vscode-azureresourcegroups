/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { callWithTelemetryAndErrorHandling, parseError, TreeElementBase } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ResourceBase, ResourceModelBase } from '../../api/src/index';
import { ext } from '../extensionVariables';
import { inCloudShell } from '../utils/inCloudShell';
import { BranchDataItemCache } from './BranchDataItemCache';
import { BranchDataItemWrapper } from './BranchDataItemWrapper';
import { InvalidItem } from './InvalidItem';
import { ResourceGroupsItem, TreeDataItem } from './ResourceGroupsItem';
import { TreeItemStateStore } from './TreeItemState';

export abstract class ResourceTreeDataProviderBase extends vscode.Disposable implements vscode.TreeDataProvider<TreeDataItem> {
    private readonly branchTreeDataChangeSubscription: vscode.Disposable;
    private readonly refreshSubscription: vscode.Disposable;
    private readonly resourceProviderManagerListener: vscode.Disposable;
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void | TreeElementBase | TreeElementBase[] | null | undefined>();

    constructor(
        protected readonly itemCache: BranchDataItemCache,
        onDidChangeBranchTreeData: vscode.Event<void | ResourceModelBase | ResourceModelBase[] | null | undefined>,
        onDidChangeResource: vscode.Event<ResourceBase | undefined>,
        onRefresh: vscode.Event<void | TreeDataItem | TreeDataItem[] | null | undefined>,
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

    protected statusSubscription: vscode.Disposable | undefined;
    private subscriptionProvider?: AzureSubscriptionProvider;

    protected async getAzureSubscriptionProvider(): Promise<AzureSubscriptionProvider> {
        // override for testing
        if (ext.testing.overrideAzureSubscriptionProvider) {
            return ext.testing.overrideAzureSubscriptionProvider();
        } else {
            if (!this.subscriptionProvider) {
                this.subscriptionProvider = await ext.subscriptionProviderFactory();

                if (!inCloudShell()) {
                    // Only outside of Cloud Shell will we monitor for ongoing session changes
                    // Inside we must avoid due to https://github.com/microsoft/vscode-dev/issues/1334
                    const one = this.subscriptionProvider.onDidSignIn(() => {
                        this.notifyTreeDataChanged();
                    });

                    const two = this.subscriptionProvider.onDidSignOut(() => {
                        this.notifyTreeDataChanged();
                    });

                    this.statusSubscription = vscode.Disposable.from(one, two);
                }
            }

            return this.subscriptionProvider;
        }
    }

    onDidChangeTreeData: vscode.Event<void | TreeElementBase | TreeElementBase[] | null | undefined> = this.onDidChangeTreeDataEmitter.event;

    notifyTreeDataChanged(data: void | ResourceModelBase | ResourceModelBase[] | null | undefined): void {
        const rgItems: TreeDataItem[] = [];

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

    async getTreeItem(element: TreeDataItem): Promise<vscode.TreeItem> {
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

    async getChildren(element?: TreeDataItem | undefined): Promise<TreeDataItem[] | null | undefined> {
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

    getParent(element: ResourceGroupsItem): vscode.ProviderResult<TreeDataItem> {
        return element.getParent?.();
    }

    async findItemById(id: string): Promise<TreeDataItem | undefined> {
        let element: TreeDataItem | undefined = undefined;
        outerLoop: while (true) {
            const children: TreeDataItem[] | null | undefined = await this.getChildren(element);

            if (!children) {
                return;
            }

            for (const child of children) {
                if (child.id?.toLowerCase() === id.toLowerCase()) {
                    return child;
                } else if (removePrefix(child.id?.toLowerCase()) === id.toLowerCase()) {
                    return child;
                } else if (this.isAncestorOf(child, id)) {
                    element = child;
                    continue outerLoop;
                }
            }

            return undefined;
        }
    }

    protected isAncestorOf(element: TreeDataItem, id: string): boolean {
        // remove accounts / <accountId>/tenant/<tenantId> from the beginning of the id
        const elementId = removePrefix(element.id) + '/';
        return id.toLowerCase().startsWith(elementId.toLowerCase());
    }

    protected abstract onGetChildren(element?: TreeDataItem | undefined): Promise<TreeDataItem[] | null | undefined>;
}

function removePrefix(id?: string): string {
    return id?.replace(/\/accounts\/.+\/tenants\/[^/]+\//i, '/') || '';
}
