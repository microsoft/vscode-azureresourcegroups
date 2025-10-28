/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureAccount, AzureSubscription, AzureSubscriptionProvider, AzureTenant, TenantIdAndAccount } from '@microsoft/vscode-azext-azureauth';
import type * as vscode from 'vscode';
import type { MockResources } from './mockServiceFactory';

export class MockAzureSubscriptionProvider implements AzureSubscriptionProvider {

    public constructor(private readonly resources: MockResources) { }

    public onRefreshSuggested(): vscode.Disposable {
        return {
            dispose: () => { /* no-op */ },
        };
    }

    public async getUnauthenticatedTenantsForAccount(): Promise<AzureTenant[]> {
        return [];
    }

    public async getAvailableSubscriptions(): Promise<AzureSubscription[]> {
        const subscriptions: AzureSubscription[] = [];
        for (const acc of await this.getAccounts()) {
            for (const tenant of await this.getTenantsForAccount(acc)) {
                subscriptions.push(...await this.getSubscriptionsForTenant(tenant));
            }
        }
        return subscriptions;
    }

    public async signIn(): Promise<boolean> {
        return true;
    }

    public async getAccounts(): Promise<AzureAccount[]> {
        return [{
            id: 'accountId',
            label: 'Mock Account',
        }];
    }

    public async getTenantsForAccount(account: AzureAccount): Promise<AzureTenant[]> {
        return [{
            account,
            tenantId: 'tenantId',
            displayName: 'Mock Tenant',
        }];
    }

    public async getSubscriptionsForTenant(tenant: TenantIdAndAccount): Promise<AzureSubscription[]> {
        return this.resources.subscriptions.map((subscription) => ({
            authentication: {
                getSession: () => {
                    return undefined;
                }
            },
            environment: {
                portalUrl: 'portalUrl',
            },
            isCustomCloud: false,
            name: subscription.name,
            tenantId: tenant.tenantId,
            account: tenant.account,
            subscriptionId: subscription.subscriptionId,
        } as unknown as AzureSubscription));
    }
}
