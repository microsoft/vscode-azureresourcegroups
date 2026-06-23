/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzureAccount, AzureSubscriptionProvider, AzureTenant, isNotSignedInError, TenantIdAndAccount } from '@microsoft/vscode-azext-azureauth';
import { IActionContext, IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import { localize } from '../../utils/localize';

export async function signInToTenant(context: IActionContext, subscriptionProvider: AzureSubscriptionProvider, account?: AzureAccount): Promise<void> {
    const tenant = await pickTenant(context, subscriptionProvider, account);
    if (tenant) {
        await subscriptionProvider.signIn(tenant);
    }
}

async function pickTenant(context: IActionContext, subscriptionProvider: AzureSubscriptionProvider, account?: AzureAccount): Promise<TenantIdAndAccount | undefined> {
    try {
        const picks = await getPicks(subscriptionProvider, account);
        if (picks.length) {
            return (await context.ui.showQuickPick(picks, {
                placeHolder: localize('selectTenantPlaceholder', 'Select a Tenant (Directory) to Sign In To'),
                matchOnDescription: true,
            })).data;
        }
    } catch (err) {
        if (!isNotSignedInError(err)) {
            throw err;
        }
    }

    return promptForTenantId(context);
}

async function getPicks(subscriptionProvider: AzureSubscriptionProvider, account?: AzureAccount): Promise<IAzureQuickPickItem<TenantIdAndAccount>[]> {
    const unauthenticatedTenants: AzureTenant[] = [];
    const accounts = account ? [account] : await subscriptionProvider.getAccounts();
    for (const account of accounts) {
        unauthenticatedTenants.push(...await subscriptionProvider.getUnauthenticatedTenantsForAccount(account));
    }

    const duplicateTenants = new Set(unauthenticatedTenants
        .filter((tenant, index, self) => index !== self.findIndex(t => t.tenantId === tenant.tenantId))
        .map(tenant => tenant.tenantId));
    const isDuplicate = (tenantId: string) => duplicateTenants.has(tenantId);

    return unauthenticatedTenants
        .sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''))
        .map(tenant => ({
            label: tenant.displayName ?? '',
            description: `${tenant.tenantId}${isDuplicate(tenant.tenantId) ? ` (${tenant.account.label})` : ''}`,
            detail: tenant.defaultDomain,
            data: tenant,
        }));
}

async function promptForTenantId(context: IActionContext): Promise<TenantIdAndAccount | undefined> {
    const tenantId = await context.ui.showInputBox({
        placeHolder: localize('enterTenantIdPlaceholder', 'Tenant ID or domain'),
        prompt: localize('enterTenantIdPrompt', 'Enter the tenant ID or domain to sign in to.'),
        validateInput: value => value?.trim() ? undefined : localize('enterTenantIdValidation', 'Enter a tenant ID or domain.'),
    });

    return tenantId ? { tenantId: tenantId.trim() } as TenantIdAndAccount : undefined;
}
