/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { apiUtils } from '@microsoft/vscode-azext-utils';
import { AzureSubscription } from 'api/src/resources/azure';
import * as vscode from 'vscode';
import { AzureAccountExtensionApi, AzureLoginStatus, AzureSubscription as AzureAccountSubscription } from '../../azure-account.api';
import { AzureSubscriptionProvider } from "./SubscriptionProvider";

async function getAzureAccountExtensionApi(): Promise<AzureAccountExtensionApi> {
    const extension = vscode.extensions.getExtension<apiUtils.AzureExtensionApiProvider>('ms-vscode.azure-account');

    if (extension) {
        if (!extension.isActive) {
            await extension.activate();
        }

        if ('getApi' in extension.exports) {
            return extension.exports.getApi<AzureAccountExtensionApi>('1');
        } else {
            // support versions of the Azure Account extension <0.10.0
            return extension.exports as unknown as AzureAccountExtensionApi;
        }
    } else {
        throw new Error('Azure Account extension is not installed.');
    }
}

let azureAccountSubscriptionProvider: AzureSubscriptionProvider | undefined;

export function createAzureAccountSubscriptionProviderFactory(): () => Promise<AzureSubscriptionProvider> {
    return async () => {
        if (!azureAccountSubscriptionProvider) {
            const api = await getAzureAccountExtensionApi();
            azureAccountSubscriptionProvider = new AzureAccountSubscriptionProvider(api);
        }
        return azureAccountSubscriptionProvider;
    }
}

class AzureAccountSubscriptionProvider implements AzureSubscriptionProvider {
    waitForFilters: () => Promise<boolean>;

    public onStatusChanged: vscode.Event<AzureLoginStatus>;
    public onFiltersChanged: vscode.Event<void>;
    public onSessionsChanged: vscode.Event<void>;
    public onSubscriptionsChanged: vscode.Event<void>;

    constructor(private readonly azureAccountApi: AzureAccountExtensionApi) {
        this.onStatusChanged = azureAccountApi.onStatusChanged;
        this.onFiltersChanged = azureAccountApi.onFiltersChanged;
        this.onSessionsChanged = azureAccountApi.onSessionsChanged;
        this.onSubscriptionsChanged = azureAccountApi.onSubscriptionsChanged;
        this.waitForFilters = azureAccountApi.waitForFilters.bind(azureAccountApi) as typeof azureAccountApi.waitForFilters;
    }

    get status(): AzureLoginStatus {
        return this.azureAccountApi.status;
    }

    get filters(): AzureSubscription[] {
        return this.azureAccountApi.filters.map(this.createAzureSubscription);
    }

    get allSubscriptions(): AzureSubscription[] {
        return this.azureAccountApi.subscriptions.map(this.createAzureSubscription);
    }

    async logIn(): Promise<void> {
        await vscode.commands.executeCommand('azure-account.login');
    }
    async logOut(): Promise<void> {
        await vscode.commands.executeCommand('azure-account.logout');
    }
    async selectSubscriptions(): Promise<void> {
        await vscode.commands.executeCommand('azure-account.selectSubscriptions');
    }

    private createAzureSubscription(subscription: AzureAccountSubscription): AzureSubscription {
        return ({
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
        });
    }
}
