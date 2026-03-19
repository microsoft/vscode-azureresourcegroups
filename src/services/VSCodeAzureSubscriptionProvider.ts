/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzureAccount, AzureTenant, GetTenantsForAccountOptions, VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { getSelectedTenantAndSubscriptionIds } from '../commands/accounts/selectSubscriptions';
import { ext } from '../extensionVariables';
import { isTenantFilteredOut } from '../utils/tenantSelection';

/**
 * Extends {@link VSCodeAzureSubscriptionProvider} to additionally filter tenants based on the
 * Accounts & Tenants view checkbox state. Without this, unselected tenants still count toward
 * the maximum tenants limit, preventing selected tenants from being processed.
 */
class ResourceGroupsSubscriptionProvider extends VSCodeAzureSubscriptionProvider {
    public override async getTenantsForAccount(account: AzureAccount, options?: GetTenantsForAccountOptions): Promise<AzureTenant[]> {
        const tenants = await super.getTenantsForAccount(account, options);

        // When filtering is enabled, also exclude tenants unchecked in the Accounts & Tenants view.
        // The base class only filters by selectedSubscriptions config; the Tenants view stores its
        // state separately in globalState as 'unselectedTenants'.
        const shouldFilter = options?.filter ?? true;
        if (shouldFilter) {
            const filtered = tenants.filter(t => !isTenantFilteredOut(t.tenantId, account.id));
            if (filtered.length < tenants.length) {
                this.logForAccount(account, `Filtered tenants for account from ${tenants.length} to ${filtered.length} based on Accounts & Tenants view selection`);
            }
            return filtered;
        }

        return tenants;
    }
}

let vscodeAzureSubscriptionProvider: VSCodeAzureSubscriptionProvider | undefined;

export function createVSCodeAzureSubscriptionProviderFactory(): () => Promise<VSCodeAzureSubscriptionProvider> {
    return async (): Promise<VSCodeAzureSubscriptionProvider> => {
        vscodeAzureSubscriptionProvider ??= await createVSCodeAzureSubscriptionProvider();
        return vscodeAzureSubscriptionProvider;
    };
}

async function createVSCodeAzureSubscriptionProvider(): Promise<VSCodeAzureSubscriptionProvider> {
    // This will update the selected subscription IDs to ensure the filters are in the form of `${tenantId}/${subscriptionId}`
    await getSelectedTenantAndSubscriptionIds();

    return new ResourceGroupsSubscriptionProvider(ext.outputChannel);
}
