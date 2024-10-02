/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import * as vscode from 'vscode';
import { ResourceModelBase } from '../../../api/src/index';
import { AzureResourceProviderManager } from '../../api/ResourceProviderManagers';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceTreeDataProviderBase } from '../ResourceTreeDataProviderBase';
import { TreeItemStateStore } from '../TreeItemState';
import { AzureResourceGroupingManager } from './grouping/AzureResourceGroupingManager';
import { GroupingItem } from './grouping/GroupingItem';

export abstract class AzureResourceTreeDataProviderBase extends ResourceTreeDataProviderBase {
    public subscriptionProvider: AzureSubscriptionProvider | undefined;
    public statusSubscription: vscode.Disposable | undefined;
    public nextSessionChangeMessageMinimumTime = 0;
    public sessionChangeMessageInterval = 1 * 1000; // 1 second

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
}
