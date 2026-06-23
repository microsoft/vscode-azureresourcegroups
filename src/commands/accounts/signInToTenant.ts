/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzureAccount, AzureSubscriptionProvider, AzureTenant, isNotSignedInError, SignInOptions, TenantIdAndAccount } from '@microsoft/vscode-azext-azureauth';
import { IActionContext, IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import { setManualSignInTenant } from '../../utils/manualSignInTenant';
import { localize } from '../../utils/localize';

type ManualTenantSignIn = Partial<TenantIdAndAccount> & Pick<TenantIdAndAccount, 'tenantId'>;
type TenantSignIn = TenantIdAndAccount | ManualTenantSignIn;
type ManualTenantSubscriptionProvider = Omit<AzureSubscriptionProvider, 'signIn'> & {
    signIn(tenant?: Partial<TenantIdAndAccount>, options?: SignInOptions): Promise<boolean>;
};

export async function signInToTenant(context: IActionContext, subscriptionProvider: ManualTenantSubscriptionProvider, account?: AzureAccount): Promise<void> {
    const tenantPick = await pickTenant(context, subscriptionProvider, account);
    if (tenantPick) {
        const signedIn = await subscriptionProvider.signIn(tenantPick.tenant);
        if (signedIn && tenantPick.isManual) {
            await setManualSignInTenant(tenantPick.tenant.tenantId);
        }
    }
}

interface TenantPick {
    tenant: TenantSignIn;
    isManual: boolean;
}

async function pickTenant(context: IActionContext, subscriptionProvider: ManualTenantSubscriptionProvider, account?: AzureAccount): Promise<TenantPick | undefined> {
    try {
        const picks = await getPicks(subscriptionProvider, account);
        if (picks.length) {
            const pick = await context.ui.showQuickPick(picks, {
                placeHolder: localize('selectTenantPlaceholder', 'Select a Tenant (Directory) to Sign In To'),
                matchOnDescription: true,
            });
            return { tenant: pick.data, isManual: false };
        }
    } catch (err) {
        if (!isNotSignedInError(err)) {
            throw err;
        }
    }

    const tenant = await promptForTenantId(context);
    return tenant ? { tenant, isManual: true } : undefined;
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
    const tenantLabel = (tenant: AzureTenant) => tenant.displayName ?? tenant.defaultDomain ?? tenant.tenantId;

    return unauthenticatedTenants
        .sort((a, b) => tenantLabel(a).localeCompare(tenantLabel(b)))
        .map(tenant => ({
            label: tenantLabel(tenant),
            description: `${tenant.tenantId}${isDuplicate(tenant.tenantId) ? ` (${tenant.account.label})` : ''}`,
            detail: tenant.defaultDomain,
            data: tenant,
        }));
}

async function promptForTenantId(context: IActionContext): Promise<ManualTenantSignIn | undefined> {
    const tenantId = await context.ui.showInputBox({
        placeHolder: localize('enterTenantIdPlaceholder', 'Tenant ID or domain'),
        prompt: localize('enterTenantIdPrompt', 'Enter the tenant ID or domain to sign in to.'),
        validateInput: value => value?.trim() ? undefined : localize('enterTenantIdValidation', 'Enter a tenant ID or domain.'),
    });

    return tenantId ? { tenantId: tenantId.trim() } : undefined;
}
