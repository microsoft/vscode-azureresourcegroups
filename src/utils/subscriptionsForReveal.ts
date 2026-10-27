/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureSubscription, AzureSubscriptionProvider, isNotSignedInError } from '@microsoft/vscode-azext-azureauth';

export async function getSubscriptionsForReveal(
    provider: AzureSubscriptionProvider,
    tenantId?: string,
    noCache = false
): Promise<AzureSubscription[]> {
    if (!tenantId) {
        // Explicit resolution must not silently stop at the authentication library's ten-tenant browsing limit.
        return await provider.getAvailableSubscriptions({ filter: false, noCache, maximumTenants: Number.MAX_SAFE_INTEGER });
    }

    const options = { filter: false, noCache };
    const accounts = await provider.getAccounts(options);
    const subscriptions = await Promise.all(accounts.map(async account => {
        const tenants = await provider.getTenantsForAccount(account, options);
        const tenant = tenants.find(candidate => candidate.tenantId.toLowerCase() === tenantId.toLowerCase());
        if (!tenant) {
            return [];
        }
        try {
            return await provider.getSubscriptionsForTenant(tenant, options);
        } catch (error) {
            if (isNotSignedInError(error)) {
                return [];
            }
            throw error;
        }
    }));
    return subscriptions.flat();
}
