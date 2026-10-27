/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureSubscription, AzureSubscriptionProvider, TenantIdAndAccount } from '@microsoft/vscode-azext-azureauth';

export interface SubscriptionDiscoveryFailure {
    tenant: TenantIdAndAccount;
    error: unknown;
}

export interface SubscriptionDiscoveryResult {
    subscriptions: AzureSubscription[];
    failures: SubscriptionDiscoveryFailure[];
}

export async function getSubscriptionsForReveal(
    provider: AzureSubscriptionProvider,
    tenantId?: string,
    noCache = false,
    accountId?: string
): Promise<SubscriptionDiscoveryResult> {
    if (!tenantId) {
        // Explicit resolution must not silently stop at the authentication library's ten-tenant browsing limit.
        return {
            subscriptions: await provider.getAvailableSubscriptions({ filter: false, noCache, maximumTenants: Number.MAX_SAFE_INTEGER }),
            failures: []
        };
    }

    const options = { filter: false, noCache };
    const accounts = await provider.getAccounts(options);
    const results = await Promise.all(accounts
        .filter(account => !accountId || account.id.toLowerCase() === accountId.toLowerCase())
        .map(async (account): Promise<SubscriptionDiscoveryResult> => {
            try {
                const tenants = await provider.getTenantsForAccount(account, options);
                const tenant = tenants.find(candidate => candidate.tenantId.toLowerCase() === tenantId.toLowerCase());
                return {
                    subscriptions: tenant ? await provider.getSubscriptionsForTenant(tenant, options) : [],
                    failures: []
                };
            } catch (error) {
                // Keep identity and failure separate from successful results; only the explicit resolver may prompt.
                return { subscriptions: [], failures: [{ tenant: { account, tenantId }, error }] };
            }
        }));
    return {
        subscriptions: results.flatMap(result => result.subscriptions),
        failures: results.flatMap(result => result.failures)
    };
}
