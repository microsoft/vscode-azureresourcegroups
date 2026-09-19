/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureAccount, AzureSubscriptionProvider, isNotSignedInError, signInToTenant as signInToTenantFromAccounts, TenantIdAndAccount } from '@microsoft/vscode-azext-azureauth';
import { IActionContext } from '@microsoft/vscode-azext-utils';
import { setConfiguredAzureTenant } from '../../utils/azureTenantSetting';
import { localize } from '../../utils/localize';

/**
 * Signs in to a specific tenant (directory).
 *
 * Delegates to the auth package's tenant picker, which lists unauthenticated tenants discovered for
 * the signed-in accounts. When the user is not signed in to any account there are no tenants to
 * enumerate, so this falls back to prompting for a tenant ID or domain. Manual entry is the only way
 * to unblock users whose tenant enforces conditional access that prevents the initial common-endpoint
 * sign-in: they have no authenticated account to enumerate tenants from, so they must direct the very
 * first sign-in at their tenant (similar to `az login --tenant <tenant>`). The entered tenant is
 * persisted to the `azure.tenant` setting so account-level tenant discovery can fall back to it on
 * later reloads (see {@link getConfiguredTenantFallback}); otherwise the sign-in succeeds but no
 * resources load.
 *
 * The `signInToTenantFromAccounts` parameter is injectable for testing; production callers use the
 * auth package's implementation.
 */
export async function signInToTenant(
    context: IActionContext,
    subscriptionProvider: AzureSubscriptionProvider,
    signInFromAccounts: (provider: AzureSubscriptionProvider, account?: AzureAccount) => Promise<void> = signInToTenantFromAccounts,
): Promise<void> {
    try {
        await signInFromAccounts(subscriptionProvider);
        return;
    } catch (error) {
        if (!isNotSignedInError(error)) {
            throw error;
        }
    }

    const tenantId = (await context.ui.showInputBox({
        placeHolder: localize('enterTenantIdPlaceholder', 'Tenant ID or domain'),
        prompt: localize('enterTenantIdPrompt', 'Enter the tenant ID or domain to sign in to.'),
        validateInput: value => value?.trim() ? undefined : localize('enterTenantIdValidation', 'Enter a tenant ID or domain.'),
    })).trim();

    // The account is filled in interactively during sign-in, so it is omitted here.
    const signedIn = await subscriptionProvider.signIn({ tenantId } as TenantIdAndAccount);
    if (signedIn) {
        // Persist only after a successful sign-in so a typo'd or cancelled attempt doesn't leave a
        // broken tenant in the user's settings that later tenant discovery would keep injecting.
        await setConfiguredAzureTenant(tenantId);
    }
}
