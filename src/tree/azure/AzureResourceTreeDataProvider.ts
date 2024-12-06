/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureSubscription, getUnauthenticatedTenants } from '@microsoft/vscode-azext-azureauth';
import { IActionContext, callWithTelemetryAndErrorHandling, createSubscriptionContext, nonNullValueAndProp, registerEvent } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ResourceModelBase } from '../../../api/src/index';
import { AzureResourceProviderManager } from '../../api/ResourceProviderManagers';
import { getDuplicateSubscriptions, getTenantFilteredSubscriptions } from '../../commands/accounts/selectSubscriptions';
import { showHiddenTypesSettingKey } from '../../constants';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { GenericItem } from '../GenericItem';
import { OnGetChildrenBase, getAzureSubscriptionProvider } from '../OnGetChildrenBase';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { TreeItemStateStore } from '../TreeItemState';
import { AzureResourceTreeDataProviderBase } from './AzureResourceTreeDataProviderBase';
import { SubscriptionItem } from './SubscriptionItem';
import { AzureResourceGroupingManager } from './grouping/AzureResourceGroupingManager';

export class AzureResourceTreeDataProvider extends AzureResourceTreeDataProviderBase {
    private readonly groupingChangeSubscription: vscode.Disposable;

    constructor(
        onDidChangeBranchTreeData: vscode.Event<void | ResourceModelBase | ResourceModelBase[] | null | undefined>,
        itemCache: BranchDataItemCache,
        state: TreeItemStateStore,
        onRefresh: vscode.Event<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>,
        protected readonly resourceGroupingManager: AzureResourceGroupingManager,
        protected readonly resourceProviderManager: AzureResourceProviderManager) {
        super(
            itemCache,
            onDidChangeBranchTreeData,
            onRefresh,
            state,
            resourceGroupingManager,
            resourceProviderManager,
            () => {
                this.groupingChangeSubscription.dispose();
            });

        registerEvent(
            'treeView.onDidChangeConfiguration',
            vscode.workspace.onDidChangeConfiguration,
            async (context: IActionContext, e: vscode.ConfigurationChangeEvent) => {
                context.errorHandling.suppressDisplay = true;
                context.telemetry.suppressIfSuccessful = true;
                context.telemetry.properties.isActivationEvent = 'true';

                if (e.affectsConfiguration(`${ext.prefix}.${showHiddenTypesSettingKey}`)) {
                    this.notifyTreeDataChanged();
                }
            });

        // TODO: This really belongs on the subscription item, but that then involves disposing of them during refresh,
        //       and I'm not sure of the mechanics of that.  Ideally grouping mode changes shouldn't require new network calls,
        //       as we're just rearranging known items; we might try caching resource items and only calling getTreeItem() on
        //       branch providers during the tree refresh that results from this (rather than getChildren() again).
        this.groupingChangeSubscription = this.resourceGroupingManager.onDidChangeGrouping(() => this.notifyTreeDataChanged());
    }

    async onGetChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined> {
        if (element) {
            return await element.getChildren();
        } else {
            const subscriptionProvider = await getAzureSubscriptionProvider(this);
            // When a user is signed in 'OnGetChildrenBase' will return no children
            const children: ResourceGroupsItem[] = await OnGetChildrenBase(subscriptionProvider, this);

            if (children.length === 0) {
                this.sendSubscriptionTelemetryIfNeeded();
                let subscriptions: AzureSubscription[];
                await vscode.commands.executeCommand('setContext', 'azureResourceGroups.needsTenantAuth', false);
                if ((subscriptions = await subscriptionProvider.getSubscriptions(true)).length === 0) {
                    if (
                        // If there are no subscriptions at all (ignoring filters) AND if unauthenicated tenants exist
                        (await subscriptionProvider.getSubscriptions(false)).length === 0 &&
                        (await getUnauthenticatedTenants(subscriptionProvider)).length > 0
                    ) {
                        // Subscriptions might exist in an unauthenticated tenant. Show welcome view.
                        await vscode.commands.executeCommand('setContext', 'azureResourceGroups.needsTenantAuth', true);
                        return [];
                    } else {
                        return [new GenericItem(localize('noSubscriptions', 'Select Subscriptions...'), {
                            commandId: 'azureResourceGroups.selectSubscriptions'
                        })]
                    }
                } else {
                    //find duplicate subscriptions and change the name to include the account name
                    const duplicates = getDuplicateSubscriptions(subscriptions);

                    const tenantFiltedSubcriptions = getTenantFilteredSubscriptions(subscriptions);
                    if (tenantFiltedSubcriptions) {
                        return tenantFiltedSubcriptions.map(
                            subscription => {
                                if (duplicates.includes(subscription)) {
                                    return new SubscriptionItem(
                                        {
                                            subscription: subscription,
                                            subscriptionContext: createSubscriptionContext(subscription),
                                            refresh: item => this.notifyTreeDataChanged(item),
                                        },
                                        this.resourceGroupingManager,
                                        this.resourceProviderManager,
                                        subscription,
                                        `(${nonNullValueAndProp(subscription.account, 'label')})`);
                                }
                                return new SubscriptionItem(
                                    {
                                        subscription: subscription,
                                        subscriptionContext: createSubscriptionContext(subscription),
                                        refresh: item => this.notifyTreeDataChanged(item),
                                    },
                                    this.resourceGroupingManager,
                                    this.resourceProviderManager,
                                    subscription)
                            });
                    } else {
                        return subscriptions.map(
                            subscription => {
                                if (duplicates.includes(subscription)) {
                                    return new SubscriptionItem(
                                        {
                                            subscription: subscription,
                                            subscriptionContext: createSubscriptionContext(subscription),
                                            refresh: item => this.notifyTreeDataChanged(item),
                                        },
                                        this.resourceGroupingManager,
                                        this.resourceProviderManager,
                                        subscription,
                                        `(${nonNullValueAndProp(subscription.account, 'label')})`);
                                }
                                return new SubscriptionItem(
                                    {
                                        subscription: subscription,
                                        subscriptionContext: createSubscriptionContext(subscription),
                                        refresh: item => this.notifyTreeDataChanged(item),
                                    },
                                    this.resourceGroupingManager,
                                    this.resourceProviderManager,
                                    subscription)
                            });
                    }
                }
            }
            return children;
        }
    }

    private hasSentSubscriptionTelemetry = false;
    private sendSubscriptionTelemetryIfNeeded(): void {
        if (this.hasSentSubscriptionTelemetry) {
            return;
        }
        this.hasSentSubscriptionTelemetry = true;

        // This event is relied upon by the DevDiv Analytics and Growth Team
        void callWithTelemetryAndErrorHandling('updateSubscriptionsAndTenants', async (context: IActionContext) => {
            context.telemetry.properties.isActivationEvent = 'true';
            context.errorHandling.suppressDisplay = true;

            const subscriptionProvider = await getAzureSubscriptionProvider(this);
            const subscriptions = await subscriptionProvider.getSubscriptions(false);

            const tenantSet = new Set<string>();
            const subscriptionSet = new Set<string>();
            subscriptions.forEach(sub => {
                tenantSet.add(sub.tenantId);
                subscriptionSet.add(sub.subscriptionId);
            });

            // Number of tenants and subscriptions really belong in Measurements but for backwards compatibility
            // they will be put into Properties instead.
            context.telemetry.properties.numtenants = tenantSet.size.toString();
            context.telemetry.properties.numsubscriptions = subscriptionSet.size.toString();
            context.telemetry.properties.subscriptions = JSON.stringify(Array.from(subscriptionSet));
        });
    }
}
