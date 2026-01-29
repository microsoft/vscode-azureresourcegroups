/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureSubscription, AzureTenant, getMetricsForTelemetry, isNotSignedInError } from '@microsoft/vscode-azext-azureauth';
import { callWithTelemetryAndErrorHandling, createSubscriptionContext, IActionContext, nonNullValueAndProp, registerEvent, TreeElementBase } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ResourceModelBase } from '../../../api/src/index';
import { AzureResourceProviderManager } from '../../api/ResourceProviderManagers';
import { getDuplicateSubscriptionModeSetting, getDuplicateSubscriptions, getDuplicateSubsInSameAccount, getTenantFilteredSubscriptions, turnOnDuplicateSubscriptionModeSetting } from '../../commands/accounts/selectSubscriptions';
import { showHiddenTypesSettingKey } from '../../constants';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { GenericItem } from '../GenericItem';
import { getSignInTreeItems, tryGetLoggingInTreeItems } from '../getSignInTreeItems';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { TreeItemStateStore } from '../TreeItemState';
import { AzureResourceTreeDataProviderBase } from './AzureResourceTreeDataProviderBase';
import { AzureResourceGroupingManager } from './grouping/AzureResourceGroupingManager';
import { SubscriptionItem } from './SubscriptionItem';

export class AzureResourceTreeDataProvider extends AzureResourceTreeDataProviderBase {
    private readonly groupingChangeSubscription: vscode.Disposable;
    private hasShownDuplicateWarning: boolean = false;
    private hasLoadedSubscriptions: boolean = false;

    constructor(
        onDidChangeBranchTreeData: vscode.Event<void | ResourceModelBase | ResourceModelBase[] | null | undefined>,
        itemCache: BranchDataItemCache,
        state: TreeItemStateStore,
        onRefresh: vscode.Event<void | TreeElementBase | TreeElementBase[] | null | undefined>,
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
        if (element?.getChildren) {
            return await element.getChildren();
        } else {
            return await this.getRootChildren();
        }
    }

    /**
     * Gets the root children (subscriptions) for the Azure Resources tree.
     * Wrapped in telemetry to measure initial load performance.
     */
    private async getRootChildren(): Promise<ResourceGroupsItem[] | null | undefined> {
        // Create cancellation token for this load operation - cancels any pending previous load
        const cancellationToken = this.createLoadCancellationToken();

        return await callWithTelemetryAndErrorHandling('azureResourceGroups.loadSubscriptions', async (context: IActionContext) => {
            context.errorHandling.suppressDisplay = true;

            const isFirstLoad = !this.hasLoadedSubscriptions;
            this.hasLoadedSubscriptions = true;
            context.telemetry.properties.isFirstLoad = String(isFirstLoad);

            const maybeLogInItems = tryGetLoggingInTreeItems();
            if (maybeLogInItems?.length) {
                context.telemetry.properties.outcome = 'loggingIn';
                return maybeLogInItems;
            }

            const subscriptionProvider = await this.getAzureSubscriptionProvider();

            // Atomically consume the clear cache flag - only the first tree to load will get true
            const shouldClearCache = ext.consumeClearCacheFlag();

            try {
                await vscode.commands.executeCommand('setContext', 'azureResourceGroups.needsTenantAuth', false);
                const subscriptions = await subscriptionProvider.getAvailableSubscriptions({ noCache: shouldClearCache, token: cancellationToken });
                this.sendSubscriptionTelemetryIfNeeded(); // Don't send until the above call is done, to avoid cache missing

                context.telemetry.measurements.subscriptionCount = subscriptions.length;

                if (subscriptions.length === 0) {
                    // No subscriptions through the filters. Decide what to show.
                    const selectSubscriptionsItem = new GenericItem(localize('noSubscriptions', 'Select Subscriptions...'), {
                        commandId: 'azureResourceGroups.selectSubscriptions'
                    });

                    const allSubscriptions = await subscriptionProvider.getAvailableSubscriptions({ filter: false });
                    if (allSubscriptions.length === 0) {
                        // No subscriptions at all (ignoring filters)
                        const allUnauthenticatedTenants: AzureTenant[] = [];
                        for (const account of await subscriptionProvider.getAccounts({ filter: false })) {
                            allUnauthenticatedTenants.push(...await subscriptionProvider.getUnauthenticatedTenantsForAccount(account));
                        }

                        if (allUnauthenticatedTenants.length > 0) {
                            // Subscriptions might exist in an unauthenticated tenant. Show welcome view.
                            await vscode.commands.executeCommand('setContext', 'azureResourceGroups.needsTenantAuth', true);
                            return [];
                        } else {
                            // All tenants are authenticated but no subscriptions exist
                            // The prior behavior was to still show the Select Subscriptions item in this case
                            // TODO: this isn't exactly right? Should we throw a `NotSignedInError` instead?
                            return [selectSubscriptionsItem];
                        }
                    } else {
                        // Subscriptions exist but are all filtered out, show the Select Subscriptions item
                        return [selectSubscriptionsItem];
                    }
                } else {
                    // User is signed in and has subscriptions - record counts
                    context.telemetry.properties.isSignedIn = 'true';
                    context.telemetry.measurements.subscriptionCount = subscriptions.length;
                    // Use provider's cached accounts instead of direct API call
                    const accounts = await subscriptionProvider.getAccounts({ filter: false });
                    context.telemetry.measurements.accountCount = accounts.length;

                    //find duplicate subscriptions and change the name to include the account name. If duplicate subs are in the same account add the tenant id instead
                    const duplicates = getDuplicateSubscriptions(subscriptions);
                    context.telemetry.properties.hasDuplicates = String(duplicates.length > 0);

                    let duplicatesWithSameAccount: AzureSubscription[] = [];
                    if (duplicates.length > 0) {
                        duplicatesWithSameAccount = getDuplicateSubsInSameAccount(duplicates);
                        context.telemetry.properties.hasDuplicatesInSameAccount = String(duplicatesWithSameAccount.length > 0);

                        if (duplicatesWithSameAccount.length > 0 && !this.hasShownDuplicateWarning) {
                            this.hasShownDuplicateWarning = true;
                            void callWithTelemetryAndErrorHandling('azureResourceGroups.duplicate', async (context: IActionContext) => {
                                if (!getDuplicateSubscriptionModeSetting()) {
                                    const turnOn: vscode.MessageItem = { title: localize('turnOn', 'Turn On') };
                                    const response: vscode.MessageItem | undefined = await context.ui.showWarningMessage(localize('turnOnSetting', 'We detected duplicate subscriptions in the same account. To have a better experience please turn on the "Duplicate Subscription Mode" setting.'), turnOn);
                                    if (response === turnOn) {
                                        await turnOnDuplicateSubscriptionModeSetting();
                                    }
                                }
                            });
                        }
                    }

                    const tenantFilteredSubcriptions = getTenantFilteredSubscriptions(subscriptions);
                    if (tenantFilteredSubcriptions) {
                        return tenantFilteredSubcriptions.map(
                            subscription => {
                                // for telemetry purposes, do not wait
                                void callWithTelemetryAndErrorHandling('azureResourceGroups.getTenantFiltedSubcription', async (context: IActionContext) => {
                                    context.telemetry.properties.subscriptionId = subscription.subscriptionId;
                                });
                                if (duplicatesWithSameAccount.includes(subscription)) {
                                    return new SubscriptionItem(
                                        {
                                            subscription: subscription,
                                            subscriptionContext: createSubscriptionContext(subscription),
                                            refresh: item => this.notifyTreeDataChanged(item),
                                        },
                                        this.resourceGroupingManager,
                                        this.resourceProviderManager,
                                        subscription,
                                        `${nonNullValueAndProp(subscription.account, 'label')} (${subscription.tenantId})`);
                                } else if (duplicates.includes(subscription)) {
                                    return new SubscriptionItem(
                                        {
                                            subscription: subscription,
                                            subscriptionContext: createSubscriptionContext(subscription),
                                            refresh: item => this.notifyTreeDataChanged(item),
                                        },
                                        this.resourceGroupingManager,
                                        this.resourceProviderManager,
                                        subscription,
                                        `${nonNullValueAndProp(subscription.account, 'label')}`);
                                }
                                return new SubscriptionItem(
                                    {
                                        subscription: subscription,
                                        subscriptionContext: createSubscriptionContext(subscription),
                                        refresh: item => this.notifyTreeDataChanged(item),
                                    },
                                    this.resourceGroupingManager,
                                    this.resourceProviderManager,
                                    subscription);
                            });
                    } else {
                        return subscriptions.map(
                            subscription => {
                                // for telemetry purposes, do not wait
                                void callWithTelemetryAndErrorHandling('azureResourceGroups.getSubscription', async (context: IActionContext) => {
                                    context.telemetry.properties.subscriptionId = subscription.subscriptionId;
                                });
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
                                    subscription);
                            });
                    }
                }
            } catch (error) {
                if (isNotSignedInError(error)) {
                    context.telemetry.properties.outcome = 'notSignedIn';
                    return getSignInTreeItems(true);
                }

                // TODO: Else do we throw? What did we do before?
                return [];
            }
        });
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

            const {
                totalAccounts,
                visibleTenants,
                visibleSubscriptions,
                subscriptionIdList,
                subscriptionIdListIsIncomplete,
            } = await getMetricsForTelemetry(await this.getAzureSubscriptionProvider());

            // These counts really belong in Measurements but for backwards compatibility
            // they will be put into Properties instead.
            context.telemetry.properties.numaccounts = totalAccounts.toString();
            context.telemetry.properties.numtenants = visibleTenants.toString();
            context.telemetry.properties.numsubscriptions = visibleSubscriptions.toString();
            context.telemetry.properties.subscriptions = subscriptionIdList;
            context.telemetry.properties.subscriptionidlistisincomplete = subscriptionIdListIsIncomplete.toString();
        });
    }
}
