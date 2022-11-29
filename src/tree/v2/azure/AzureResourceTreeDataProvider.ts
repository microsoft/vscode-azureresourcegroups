/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtServiceClientCredentials, IActionContext, nonNullProp, registerEvent } from '@microsoft/vscode-azext-utils';
import { AzureExtensionApiProvider } from '@microsoft/vscode-azext-utils/api';
import * as vscode from 'vscode';
import { ApplicationResourceProviderManager } from '../../../api/v2/ResourceProviderManagers';
import { ResourceModelBase } from '../../../api/v2/v2AzureResourcesApi';
import { showHiddenTypesSettingKey } from '../../../constants';
import { ext } from '../../../extensionVariables';
import { localize } from '../../../utils/localize';
import { AzureAccountExtensionApi } from '../azure-account.api';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { GenericItem } from '../GenericItem';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceTreeDataProviderBase } from '../ResourceTreeDataProviderBase';
import { AzureResourceGroupingManager } from './AzureResourceGroupingManager';
import { GroupingItem } from './GroupingItem';
import { SubscriptionItem } from './SubscriptionItem';

export class AzureResourceTreeDataProvider extends ResourceTreeDataProviderBase {
    private readonly groupingChangeSubscription: vscode.Disposable;

    private api: AzureAccountExtensionApi | undefined;
    private filtersSubscription: vscode.Disposable | undefined;
    private statusSubscription: vscode.Disposable | undefined;

    constructor(
        onDidChangeBranchTreeData: vscode.Event<void | ResourceModelBase | ResourceModelBase[] | null | undefined>,
        itemCache: BranchDataItemCache,
        onRefresh: vscode.Event<void>,
        private readonly resourceGroupingManager: AzureResourceGroupingManager,
        private readonly resourceProviderManager: ApplicationResourceProviderManager) {
        super(
            itemCache,
            onDidChangeBranchTreeData,
            resourceProviderManager.onDidChangeResourceChange,
            onRefresh,
            () => {
                this.groupingChangeSubscription.dispose();
                this.filtersSubscription?.dispose();
                this.statusSubscription?.dispose();
            });

        registerEvent(
            'treeView.onDidChangeConfiguration',
            vscode.workspace.onDidChangeConfiguration,
            async (context: IActionContext, e: vscode.ConfigurationChangeEvent) => {
                context.errorHandling.suppressDisplay = true;
                context.telemetry.suppressIfSuccessful = true;
                context.telemetry.properties.isActivationEvent = 'true';

                if (e.affectsConfiguration(`${ext.prefix}.${showHiddenTypesSettingKey}`)) {
                    this.onDidChangeTreeDataEmitter.fire();
                }
            });

        // TODO: This really belongs on the subscription item, but that then involves disposing of them during refresh,
        //       and I'm not sure of the mechanics of that.  Ideally grouping mode changes shouldn't require new network calls,
        //       as we're just rearranging known items; we might try caching resource items and only calling getTreeItem() on
        //       branch providers during the tree refresh that results from this (rather than getChildren() again).
        this.groupingChangeSubscription = this.resourceGroupingManager.onDidChangeGrouping(() => this.onDidChangeTreeDataEmitter.fire());
    }

    async onGetChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined> {
        if (element) {
            return await element.getChildren();
        } else {
            const api = await this.getAzureAccountExtensionApi();

            if (api) {
                if (api.status === 'LoggedIn') {
                    if (api.filters.length === 0) {
                        return [new GenericItem(localize('noSubscriptions', 'Select Subscriptions...'), { commandId: 'azure-account.selectSubscriptions' })]
                    } else {
                        return api.filters.map(
                            subscription => new SubscriptionItem(
                                {
                                    subscriptionContext: {
                                        credentials: <AzExtServiceClientCredentials>subscription.session.credentials2,
                                        subscriptionDisplayName: nonNullProp(subscription.subscription, 'displayName'),
                                        subscriptionId: nonNullProp(subscription.subscription, 'subscriptionId'),
                                        subscriptionPath: nonNullProp(subscription.subscription, 'id'),
                                        tenantId: subscription.session.tenantId,
                                        userId: subscription.session.userId,
                                        environment: subscription.session.environment,
                                        isCustomCloud: subscription.session.environment.name === 'AzureCustomCloud'
                                    },
                                    refresh: item => this.onDidChangeTreeDataEmitter.fire(item),
                                },
                                this.resourceGroupingManager,
                                this.resourceProviderManager,
                                {
                                    authentication: {
                                        getSession: async scopes => {
                                            const token = await subscription.session.credentials2.getToken(scopes ?? []);

                                            if (!token) {
                                                return undefined;
                                            }

                                            return {
                                                accessToken: token.token,
                                                account: {
                                                    id: subscription.session.userId,
                                                    label: subscription.session.userId
                                                },
                                                id: 'microsoft',
                                                scopes: scopes ?? []
                                            };
                                        }
                                    },
                                    name: subscription.subscription.displayName || 'TODO: ever undefined?',
                                    environment: subscription.session.environment,
                                    isCustomCloud: subscription.session.environment.name === 'AzureCustomCloud',
                                    subscriptionId: subscription.subscription.subscriptionId || 'TODO: ever undefined?',
                                    tenantId: subscription.session.tenantId
                                }));
                    }
                } else if (api.status === 'LoggedOut') {
                    return [
                        new GenericItem(
                            localize('signInLabel', 'Sign in to Azure...'),
                            {
                                commandId: 'azure-account.login',
                                iconPath: new vscode.ThemeIcon('sign-in')
                            }),
                        new GenericItem(
                            localize('createAccountLabel', 'Create an Azure Account...'),
                            {
                                commandId: 'azure-account.createAccount',
                                iconPath: new vscode.ThemeIcon('add')
                            }),
                        new GenericItem(
                            localize('createStudentAccount', 'Create an Azure for Students Account...'),
                            {
                                commandId: 'azureResourceGroups.openUrl',
                                commandArgs: ['https://aka.ms/student-account'],
                                iconPath: new vscode.ThemeIcon('mortar-board')
                            }),
                    ];
                } else {
                    return [
                        new GenericItem(
                            api.status === 'Initializing'
                                ? localize('loadingTreeItem', 'Loading...')
                                : localize('signingIn', 'Waiting for Azure sign-in...'),
                            {
                                commandId: 'azure-account.login',
                                iconPath: new vscode.ThemeIcon('loading~spin')
                            })
                    ];
                }
            }
        }

        return undefined;
    }

    protected override isAncestorOf(element: ResourceGroupsItem, id: string): boolean {
        if (element instanceof GroupingItem) {
            return element.resources.some(resource => id.startsWith(resource.id));
        }
        return super.isAncestorOf(element, id)
    }

    private async getAzureAccountExtensionApi(): Promise<AzureAccountExtensionApi | undefined> {
        if (!this.api) {
            const extension = vscode.extensions.getExtension<AzureExtensionApiProvider>('ms-vscode.azure-account');

            if (extension) {
                if (!extension.isActive) {
                    await extension.activate();
                }

                this.api = extension.exports.getApi<AzureAccountExtensionApi>('1');

                if (this.api) {
                    await this.api.waitForFilters();

                    this.filtersSubscription = this.api.onFiltersChanged(() => this.onDidChangeTreeDataEmitter.fire());
                    this.statusSubscription = this.api.onStatusChanged(() => this.onDidChangeTreeDataEmitter.fire());
                }
            }
        }

        return this.api;
    }
}
