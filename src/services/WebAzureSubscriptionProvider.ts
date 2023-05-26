/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as arm from '@azure/arm-subscriptions';
import { Environment } from '@azure/ms-rest-azure-env';
import { uiUtils } from '@microsoft/vscode-azext-azureutils';
import { callWithTelemetryAndErrorHandling, IActionContext, nonNullValue } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { AzureSubscription } from '../../api/src/index';
import { AzureLoginStatus } from '../../azure-account.api';
import { localize } from '../utils/localize';
import { settingUtils } from '../utils/settingUtils';
import { AzureSubscriptionProvider } from './SubscriptionProvider';

type AzureSubscriptionsResult = {
    readonly status: AzureLoginStatus;
    readonly allSubscriptions: AzureSubscription[];
    readonly filters: AzureSubscription[];
}

let webSubscriptionProvider: AzureSubscriptionProvider | undefined;

export function createWebSubscriptionProviderFactory(context: vscode.ExtensionContext): () => Promise<AzureSubscriptionProvider> {
    return async (): Promise<AzureSubscriptionProvider> => {
        webSubscriptionProvider ??= await VSCodeAzureSubscriptionProvider.Create(context.globalState);
        return webSubscriptionProvider;
    }
}

class VSCodeAzureSubscriptionProvider extends vscode.Disposable implements AzureSubscriptionProvider {
    allSubscriptions: AzureSubscription[] = [];

    public readonly onStatusChangedEmitter: vscode.EventEmitter<AzureLoginStatus> = new vscode.EventEmitter<AzureLoginStatus>();
    public readonly onFiltersChangedEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onSessionsChangedEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onSubscriptionsChangedEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();

    public readonly onStatusChanged: vscode.Event<AzureLoginStatus>;
    public readonly onFiltersChanged: vscode.Event<void>;
    public readonly onSessionsChanged: vscode.Event<void>;
    public readonly onSubscriptionsChanged: vscode.Event<void>;

    public subscriptionResultsTask: () => Promise<AzureSubscriptionsResult>;

    static async Create(storage: vscode.Memento): Promise<VSCodeAzureSubscriptionProvider> {
        // clear setting value if there's a value that doesn't include the tenant id
        // see https://github.com/microsoft/vscode-azureresourcegroups/pull/684
        const selectedSubscriptionIds = settingUtils.getGlobalSetting<string[] | undefined>('selectedSubscriptions');
        if (selectedSubscriptionIds?.some(id => !id.includes('/'))) {
            await settingUtils.updateGlobalSetting('selectedSubscriptions', []);
        }
        return new VSCodeAzureSubscriptionProvider(storage);
    }

    private constructor(private readonly storage: vscode.Memento) {
        super(() => this.onSubscriptionsChangedEmitter.dispose());

        this.subscriptionResultsTask = this.getSubscriptions;

        this.onStatusChanged = this.onStatusChangedEmitter.event;
        this.onFiltersChanged = this.onFiltersChangedEmitter.event;
        this.onSessionsChanged = this.onSessionsChangedEmitter.event;
        this.onSubscriptionsChanged = this.onSubscriptionsChangedEmitter.event;
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

        this.allSubscriptions = allSubscriptions;

        return {
            status: session ? 'LoggedIn' : 'LoggedOut',
            allSubscriptions,
            filters: this.filters,
        };
    }

    get filters(): AzureSubscription[] {
        const selectedSubscriptionIds = settingUtils.getGlobalSetting<string[] | undefined>('selectedSubscriptions');
        const subscriptions = this.allSubscriptions
            .filter(s =>
                selectedSubscriptionIds === undefined ||
                selectedSubscriptionIds.length === 0 ||
                selectedSubscriptionIds.includes(`${s.tenantId}/${s.subscriptionId}`)
            )
            .sort((a, b) => a.name.localeCompare(b.name));
        return subscriptions;
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

    async selectSubscriptions(): Promise<void> {
        this.subscriptionResultsTask = this.getSubscriptions;

        if (this.status === 'LoggedIn') {

            const subscriptionQuickPickItems: () => Promise<(vscode.QuickPickItem & { subscription: AzureSubscription })[]> = async () => {

                await this.subscriptionResultsTask();

                return this
                    .allSubscriptions
                    .map(subscription => ({
                        label: subscription.name,
                        picked: this.filters.includes(subscription),
                        subscription
                    }))
                    .sort((a, b) => a.label.localeCompare(b.label));
            }

            const picks = await vscode.window.showQuickPick(
                subscriptionQuickPickItems(),
                {
                    canPickMany: true,
                    placeHolder: 'Select Subscriptions'
                });

            if (picks) {
                await this.updateSelectedSubscriptions(picks.length < this.allSubscriptions.length ? picks.map(p => p.subscription) : undefined);
            }
        } else {
            const signIn: vscode.MessageItem = { title: localize('signIn', 'Sign In') };
            void vscode.window.showInformationMessage(localize('notSignedIn', 'You are not signed in. Sign in to continue.'), signIn).then((input) => {
                if (input === signIn) {
                    void this.logIn();
                }
            });
        }

        this.onSubscriptionsChangedEmitter.fire();
        this.onFiltersChangedEmitter.fire();
    }

    public async waitForFilters(): Promise<boolean> {
        return await callWithTelemetryAndErrorHandling('waitForFilters', async (_context: IActionContext) => {
            if (!(await this.waitForSubscriptions())) {
                return false;
            }

            await this.subscriptionResultsTask();
            return true;
        }) || false;
    }

    public async waitForLogin(): Promise<boolean> {
        return await callWithTelemetryAndErrorHandling('waitForLogin', (_context: IActionContext) => {

            switch (this.status) {
                case 'LoggedIn':
                    return true;
                case 'LoggedOut':
                    return false;
                case 'Initializing':
                case 'LoggingIn':
                    return new Promise<boolean>(resolve => {
                        const subscription: vscode.Disposable = this.onStatusChanged(() => {
                            subscription.dispose();
                            resolve(this.waitForLogin());
                        });
                    });
                default:
                    const status: never = this.status;
                    throw new Error(`Unexpected status '${status}'`);
            }
        }) || false;
    }

    public async waitForSubscriptions(isLegacyApi?: boolean): Promise<boolean> {
        return await callWithTelemetryAndErrorHandling('waitForSubscriptions', async (context: IActionContext) => {
            context.telemetry.properties.isLegacyApi = String(!!isLegacyApi);

            if (!(await this.waitForLogin())) {
                return false;
            }

            await this.subscriptionResultsTask();
            return true;
        }) || false;
    }

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

        this.onStatusChangedEmitter.fire(this.status);
        this.onSubscriptionsChangedEmitter.fire();
    }

    private updateSelectedSubscriptions(subscriptions?: Pick<AzureSubscription, 'subscriptionId' | 'tenantId'>[]): Promise<void> {
        this.onFiltersChangedEmitter.fire();
        return settingUtils.updateGlobalSetting<string[] | undefined>('selectedSubscriptions', subscriptions?.map(s => `${s.tenantId}/${s.subscriptionId}`));
    }

    private async getSubscriptionsFromTenant(tenantId?: string): Promise<{ client: arm.SubscriptionClient, subscriptions: AzureSubscription[] }> {
        let session: vscode.AuthenticationSession | undefined;

        const client: arm.SubscriptionClient = new arm.SubscriptionClient(
            {
                // returns a token to be used by the subscription client
                // the token is associated with a session
                // the session is associated with a specific tenant, or if tenantId is undefined, the default tenant
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

        // if a specific tenant is associated with the token returned by getToken, then the returned values will have the `tenantId` property set
        // if the token is associated with the default tenant, the values `tenantId` property is an empty string
        const subscriptions = await uiUtils.listAllIterator(client.subscriptions.list());

        return {
            client,
            subscriptions: subscriptions.map(s => ({
                displayName: s.displayName ?? 'name',
                authentication: {
                    getSession: () => session
                },
                environment: Environment.AzureCloud,
                isCustomCloud: false,
                name: s.displayName || 'TODO: ever undefined?',
                // `s.tenantId` will be an empty string if the subscription is associated with the default tenant
                // in that case, grab the default tenant id from the session
                tenantId: s.tenantId || this.getTenantIdFromSession(nonNullValue(session)),
                subscriptionId: s.subscriptionId ?? 'id',
            })),
        };
    }

    private getTenantIdFromSession(session: vscode.AuthenticationSession): string {
        return session.id.split('/')[0];
    }
}
