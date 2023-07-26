/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import * as vscode from 'vscode';
import { ResourceModelBase } from '../../../api/src/index';
import { AzureResourceProviderManager } from '../../api/ResourceProviderManagers';
import { ext } from '../../extensionVariables';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceTreeDataProviderBase } from '../ResourceTreeDataProviderBase';
import { TreeItemStateStore } from '../TreeItemState';
import { AzureResourceGroupingManager } from './grouping/AzureResourceGroupingManager';
import { GroupingItem } from './grouping/GroupingItem';

export abstract class AzureResourceTreeDataProviderBase extends ResourceTreeDataProviderBase {
    private subscriptionProvider: AzureSubscriptionProvider | undefined;
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

    protected async getAzureSubscriptionProvider(): Promise<AzureSubscriptionProvider> {
        // override for testing
        if (ext.testing.overrideAzureSubscriptionProvider) {
            return ext.testing.overrideAzureSubscriptionProvider();
        } else {
            if (!this.subscriptionProvider) {
                this.subscriptionProvider = await ext.subscriptionProviderFactory();
            }

            this.statusSubscription = vscode.authentication.onDidChangeSessions((evt: vscode.AuthenticationSessionsChangeEvent) => {
                if (evt.provider.id === 'microsoft' || evt.provider.id === 'microsoft-sovereign-cloud') {
                    if (Date.now() > nextSessionChangeMessageMinimumTime) {
                        nextSessionChangeMessageMinimumTime = Date.now() + sessionChangeMessageInterval;
                        // This event gets HEAVILY spammed and needs to be debounced
                        // Suppress additional messages for 1 second after the first one
                        this.notifyTreeDataChanged();
                    }
                }
            });

            return this.subscriptionProvider;
        }
    }
}

let nextSessionChangeMessageMinimumTime = 0;
const sessionChangeMessageInterval = 1 * 1000; // 1 second
