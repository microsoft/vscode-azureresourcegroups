/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureSubscription, AzureTenant, getMetricsForTelemetry, isNotSignedInError } from '@microsoft/vscode-azext-azureauth';
import { callWithTelemetryAndErrorHandling, createSubscriptionContext, IActionContext, nonNullValueAndProp, registerEvent, TreeElementBase, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ResourceModelBase } from '../../../api/src/index';
import { AzureResourceProviderManager } from '../../api/ResourceProviderManagers';
import { getDuplicateSubscriptionModeSetting, getDuplicateSubscriptions, getDuplicateSubsInSameAccount, getTenantFilteredSubscriptions, turnOnDuplicateSubscriptionModeSetting } from '../../commands/accounts/selectSubscriptions';
import { showHiddenTypesSettingKey } from '../../constants';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { callWithTreeErrorHandling, TreeTraversalContext } from '../../utils/treeOperations';
import { getSubscriptionsForReveal } from '../../utils/subscriptionsForReveal';
import { getAccountAndTenantPrefix } from './idPrefix';
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
    private readonly revealedSubscriptions = new Set<string>();

    async resolveSubscriptionForReveal(context: IActionContext, subscriptionId: string, tenantId?: string, includeFilteredSubscription = false): Promise<string> {
        const provider = await this.getAzureSubscriptionProvider();
        let available: AzureSubscription[];
        try {
            available = await getSubscriptionsForReveal(provider, tenantId);
        } catch (error) {
            if (!isNotSignedInError(error)) {
                throw error;
            }
            if (!await provider.signIn()) {
                throw new UserCancelledError();
            }
            available = await getSubscriptionsForReveal(provider, tenantId, true);
        }
        const matching = available.filter(subscription =>
            subscription.subscriptionId.toLowerCase() === subscriptionId.toLowerCase()
            && (!tenantId || subscription.tenantId.toLowerCase() === tenantId.toLowerCase()));
        if (matching.length === 0) {
            throw new Error(localize('revealSubscriptionUnavailable', 'The requested subscription is not available in the requested tenant. Sign in to the appropriate account and try again.'));
        }

        const subscription = matching.length === 1 ? matching[0] : (await context.ui.showQuickPick(
            matching.map(subscription => ({
                label: subscription.name,
                description: subscription.account.label,
                detail: subscription.tenantId,
                data: subscription
            })),
            { placeHolder: localize('selectRevealSubscription', 'Select the account and tenant to open this resource') }
        )).data;
        const id = this.getSubscriptionTreeId(subscription);

        if (includeFilteredSubscription) {
            this.revealedSubscriptions.add(id.toLowerCase());
            this.notifyTreeDataChanged();
        }

        return id;
    }

    private getSubscriptionTreeId(subscription: AzureSubscription): string {
        return `${getAccountAndTenantPrefix(subscription)}/subscriptions/${subscription.subscriptionId}`;
    }

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

    async onGetChildren(element?: ResourceGroupsItem | undefined, options?: TreeTraversalContext): Promise<ResourceGroupsItem[] | null | undefined> {
        if (element?.getChildren) {
            return await element.getChildren(options);
        } else {
            return await this.getRootChildren(options);
        }
    }

    /**
     * Gets the root children (subscriptions) for the Azure Resources tree.
     * Wrapped in telemetry to measure initial load performance.
     */
    private async getRootChildren(options?: TreeTraversalContext): Promise<ResourceGroupsItem[] | null | undefined> {
        return await callWithTreeErrorHandling('azureResourceGroups.loadSubscriptions', async (context: IActionContext) => {
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

            const shouldClearCache = ext.consumeClearCacheFlag('azure');

            try {
                await vscode.commands.executeCommand('setContext', 'azureResourceGroups.needsTenantAuth', false);
                const subscriptions = getTenantFilteredSubscriptions(
                    await subscriptionProvider.getAvailableSubscriptions({ noCache: shouldClearCache }));
                if (this.revealedSubscriptions.size > 0) {
                    // Resolve against current authentication state, never retain credentials across sign-out.
                    const tenantIds = new Set([...this.revealedSubscriptions].map(id => id.split('/')[4]));
                    const available = (await Promise.all([...tenantIds].map(
                        tenantId => getSubscriptionsForReveal(subscriptionProvider, tenantId)))).flat();
                    const visibleIds = new Set(subscriptions.map(subscription => this.getSubscriptionTreeId(subscription).toLowerCase()));
                    for (const subscription of available) {
                        const id = this.getSubscriptionTreeId(subscription).toLowerCase();
                        if (this.revealedSubscriptions.has(id) && !visibleIds.has(id)) {
                            subscriptions.push(subscription);
                            visibleIds.add(id);
                        }
                    }
                }
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
                            // All tenants are authenticated but no subscriptions exist.
                            // Show "Select Subscriptions..." to preserve prior behavior and provide
                            // a consistent UX, rather than throwing NotSignedInError.
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

                    return subscriptions.map(
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
                }
            } catch (error) {
                if (options?.propagateErrors) {
                    throw error;
                }
                if (isNotSignedInError(error)) {
                    context.telemetry.properties.outcome = 'notSignedIn';
                    return getSignInTreeItems(true);
                }

                // For unexpected errors, log via telemetry but return empty array
                // to avoid disrupting the UI (preserving prior behavior).
                context.telemetry.properties.outcome = 'error';
                context.telemetry.properties.unhandledError = String(error);
                return [];
            }
        }, options);
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
