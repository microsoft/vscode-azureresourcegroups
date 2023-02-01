/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/
import * as arm from '@azure/arm-subscriptions';
import type { Environment } from '@azure/ms-rest-azure-env';
import { uiUtils } from '@microsoft/vscode-azext-azureutils';
import { AzureSubscription } from '@microsoft/vscode-azext-utils/hostapi.v2';
import * as vscode from 'vscode';
import { AzureLoginStatus } from '../tree/azure-account.api';
import { settingUtils } from '../utils/settingUtils';

export type AzureSubscriptionsResult = {
    readonly status: AzureLoginStatus;
    readonly allSubscriptions: AzureSubscription[];
    readonly filters: AzureSubscription[];
}

export interface AzureSubscriptionProvider {
    getSubscriptions(): Promise<AzureSubscriptionsResult>;

    logIn(): Promise<void>;
    logOut(): Promise<void>;
    selectSubscriptions(subscriptionIds: string[] | undefined): Promise<void>;

    onSubscriptionsChanged: vscode.Event<void>;
}

export class VSCodeAzureSubscriptionProvider extends vscode.Disposable implements AzureSubscriptionProvider {
    private readonly _onSubscriptionsChanged = new vscode.EventEmitter<void>();

    constructor(private readonly storage: vscode.Memento) {
        super(() => this._onSubscriptionsChanged.dispose());
    }

    async getSubscriptions(): Promise<AzureSubscriptionsResult> {
        if (!this.isLoggedIn()) {
            return {
                status: 'LoggedOut',
                allSubscriptions: [],
                filters: []
            };
        }

        // Try to get the default session to verify the user is really logged-in...
        const session = await this.getSession();

        if (!session) {
            return {
                status: 'LoggedOut',
                allSubscriptions: [],
                filters: []
            };
        }

        const allSubscriptions: AzureSubscription[] = [];

        const defaultTenantSubscriptions = await this.getSubscriptionsFromTenant();

        allSubscriptions.push(...defaultTenantSubscriptions.subscriptions);

        // For now, only fetch subscriptions from individual tenants if none were found in the default tenant...
        if (allSubscriptions.length === 0) {
            const tenants = await uiUtils.listAllIterator(defaultTenantSubscriptions.client.tenants.list());

            for (const tenant of tenants) {
                const tenantSubscriptions = await this.getSubscriptionsFromTenant(tenant.tenantId);

                allSubscriptions.push(...tenantSubscriptions.subscriptions);
            }
        }

        const selectedSubscriptionIds = settingUtils.getGlobalSetting<string[] | undefined>('selectedSubscriptions');
        const filters = allSubscriptions.filter(s => selectedSubscriptionIds === undefined || selectedSubscriptionIds.includes(s.subscriptionId));

        return {
            status: session ? 'LoggedIn' : 'LoggedOut',
            allSubscriptions,
            filters
        };
    }

    async logIn(): Promise<void> {
        const session = await this.getSession({ createNew: true });

        if (session) {
            await this.updateStatus(true);
        }
    }

    async logOut(): Promise<void> {
        await this.updateStatus(false);
    }

    get status(): AzureLoginStatus {
        if (!this.isLoggedIn()) {
            return 'LoggedOut'
        } else {
            return 'LoggedIn'
        }
    }

    async selectSubscriptions(subscriptionIds: string[] | undefined): Promise<void> {
        await this.updateSelectedSubscriptions(subscriptionIds);


        this._onSubscriptionsChanged.fire();
    }

    readonly onSubscriptionsChanged = this._onSubscriptionsChanged.event;

    private isLoggedIn(): boolean {
        return this.storage.get('isLoggedIn', false);
    }

    private getSession(options?: { createNew?: boolean, scopes?: string | string[], tenantId?: string }): Thenable<vscode.AuthenticationSession | undefined> {
        const scopeSet = new Set<string>(['https://management.azure.com/.default']);

        if (options) {
            if (typeof options.scopes === 'string') {
                scopeSet.add(options.scopes);
            }

            if (Array.isArray(options.scopes)) {
                for (const scope of options.scopes) {
                    scopeSet.add(scope);
                }
            }

            if (options.tenantId) {
                scopeSet.add(`VSCODE_TENANT:${options.tenantId}`);
            }
        }

        return vscode.authentication.getSession(
            'microsoft',
            Array.from(scopeSet),
            {
                clearSessionPreference: options?.createNew,
                createIfNone: options?.createNew
            });
    }

    private async updateStatus(isLoggedIn: boolean): Promise<void> {
        await this.storage.update('isLoggedIn', isLoggedIn);

        if (!isLoggedIn) {
            await this.updateSelectedSubscriptions(undefined);
        }

        this._onSubscriptionsChanged.fire();
    }

    private updateSelectedSubscriptions(subscriptionsIds: string[] | undefined): Promise<void> {
        return settingUtils.updateGlobalSetting<string[] | undefined>('selectedSubscriptions', subscriptionsIds);
    }

    private async getSubscriptionsFromTenant(tenantId?: string): Promise<{ client: arm.SubscriptionClient, subscriptions: AzureSubscription[] }> {
        let session: vscode.AuthenticationSession | undefined;

        const client: arm.SubscriptionClient = new arm.SubscriptionClient(
            {
                getToken: async scopes => {
                    session = await this.getSession({ scopes, tenantId });

                    if (session) {
                        return {
                            token: session.accessToken,
                            expiresOnTimestamp: 0
                        };
                    }

                    return null;
                },
            });

        const subscriptions = await uiUtils.listAllIterator(client.subscriptions.list());

        return {
            client,
            subscriptions: subscriptions.map(s => (
                {
                    displayName: s.displayName ?? 'name',
                    authentication: {
                        getSession: () => session
                    },
                    environment: {} as Environment,
                    isCustomCloud: false,
                    name: s.displayName || 'TODO: ever undefined?',
                    tenantId: '',
                    subscriptionId: s.subscriptionId ?? 'id',
                })),
        };
    }
}
