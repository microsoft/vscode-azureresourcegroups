/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ResourceModelBase } from '../../../api/src/index';
import { AzureResourceProviderManager } from '../../api/ResourceProviderManagers';
import { ext } from '../../extensionVariables';
import { AzureSubscriptionProvider } from '../../services/SubscriptionProvider';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceTreeDataProviderBase } from '../ResourceTreeDataProviderBase';
import { TreeItemStateStore } from '../TreeItemState';
import { AzureResourceGroupingManager } from './AzureResourceGroupingManager';
import { GroupingItem } from './GroupingItem';

export abstract class AzureResourceTreeDataProviderBase extends ResourceTreeDataProviderBase {
    private subscriptionProvider: AzureSubscriptionProvider | undefined;
    private filtersSubscription: vscode.Disposable | undefined;
    private statusSubscription: vscode.Disposable | undefined;

    constructor(
        itemCache: BranchDataItemCache,
        onDidChangeBranchTreeData: vscode.Event<void | ResourceModelBase | ResourceModelBase[] | null | undefined>,
        onRefresh: vscode.Event<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>,
        state: TreeItemStateStore,
        protected readonly resourceGroupingManager: AzureResourceGroupingManager,
        protected readonly resourceProviderManager: AzureResourceProviderManager,
        callOnDispose?: () => void) {
        super(
            itemCache,
            onDidChangeBranchTreeData,
            resourceProviderManager.onDidChangeResourceChange,
            onRefresh,
            state,
            () => {
                this.filtersSubscription?.dispose();
                this.statusSubscription?.dispose();
                callOnDispose?.();
            });
    }

    abstract onGetChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined>;

    protected override isAncestorOf(element: ResourceGroupsItem, id: string): boolean {
        if (element instanceof GroupingItem) {
            return element.resources.some(resource => id.toLowerCase().startsWith(resource.id.toLowerCase()));
        }
        return super.isAncestorOf(element, id)
    }

    protected async getAzureAccountExtensionApi(): Promise<AzureSubscriptionProvider> {
        // override for testing
        if (ext.testing.overrideAzureSubscriptionProvider) {
            return ext.testing.overrideAzureSubscriptionProvider();
        } else {
            if (!this.subscriptionProvider) {
                this.subscriptionProvider = await ext.subscriptionProviderFactory();
                await this.subscriptionProvider.waitForFilters();
            }

            this.filtersSubscription = this.subscriptionProvider.onFiltersChanged(() => this.notifyTreeDataChanged());
            this.statusSubscription = this.subscriptionProvider.onStatusChanged(() => this.notifyTreeDataChanged());

            return this.subscriptionProvider;
        }
    }
}
