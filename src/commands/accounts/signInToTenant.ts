/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { isNotSignedInError, signInToTenant as signInToTenantFromAccounts, TenantIdAndAccount } from '@microsoft/vscode-azext-azureauth';
import { IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';

/**
 * Signs in to a specific tenant (directory).
 *
 * When the user is already signed in, this delegates to the auth package's tenant picker, which
 * lists unauthenticated tenants discovered for the signed-in accounts. When the user is not signed
 * in to any account, there are no tenants to enumerate, so this falls back to prompting for a tenant
 * ID or domain. Manual entry is the only way to unblock users whose tenant enforces conditional
 * access that prevents the initial common-endpoint sign-in: they have no authenticated account to
 * enumerate tenants from, so they must direct the very first sign-in at their tenant by entering its
 * ID or domain (similar to `az login --tenant <tenant>`).
 */
export async function signInToTenant(context: IActionContext): Promise<void> {
    const provider = await ext.subscriptionProviderFactory();

    try {
        await signInToTenantFromAccounts(provider);
    } catch (error) {
        if (!isNotSignedInError(error)) {
            throw error;
        }

        // Not signed in to any account, so no tenants can be enumerated. Prompt for a tenant to
        // direct the initial sign-in at, which is exactly the flow needed to unblock conditional
        // access tenants.
        const tenantId = (await context.ui.showInputBox({
            prompt: localize('enterTenant', 'Enter the tenant (directory) ID or domain name to sign in to'),
            validateInput: (value: string) => value?.trim() ? undefined : localize('tenantRequired', 'A tenant ID or domain is required.'),
        })).trim();

        // The account is filled in interactively during sign-in, so it is omitted here.
        await provider.signIn({ tenantId } as TenantIdAndAccount);
    }

    ext.setClearCacheOnNextLoad('tenant');
    ext.actions.refreshTenantTree();
    ext.setClearCacheOnNextLoad('azure');
    ext.actions.refreshAzureTree();
    ext.setClearCacheOnNextLoad('focus');
    ext.actions.refreshFocusTree();
}
