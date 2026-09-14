/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureAccount, AzureTenant } from '@microsoft/vscode-azext-azureauth';
import * as vscode from 'vscode';

export const azureTenantSettingKey = 'azure.tenant';

export function normalizeConfiguredTenant(tenant: string | undefined): string | undefined {
    const trimmedTenant = tenant?.trim();
    return trimmedTenant ? trimmedTenant : undefined;
}

export function getConfiguredAzureTenant(): string | undefined {
    return normalizeConfiguredTenant(vscode.workspace.getConfiguration().get<string>(azureTenantSettingKey));
}

export async function setConfiguredAzureTenant(tenant: string | undefined): Promise<void> {
    await vscode.workspace.getConfiguration().update(azureTenantSettingKey, normalizeConfiguredTenant(tenant), vscode.ConfigurationTarget.Global);
}

/**
 * Returns the configured tenant as a synthetic {@link AzureTenant} for the given account, or
 * `undefined` when no tenant is configured.
 *
 * This is the conditional-access bootstrap: when ARM tenant discovery returns nothing for an
 * account (the account can't enumerate tenants because conditional access blocks the silent
 * common-endpoint token), the configured tenant is injected so the normal per-tenant sign-in and
 * subscription flow can run against the tenant's own session.
 *
 * `displayName` is set to the configured value because the Accounts & Tenants view renders every
 * tenant through `TenantTreeItem`, which requires a non-null `displayName`; without one the view
 * would throw and render empty. The real directory name isn't known (that's what discovery would
 * have told us), so the entered ID/domain is the best label available.
 */
export function getConfiguredTenantFallback(account: AzureAccount, configuredTenant: string | undefined = getConfiguredAzureTenant()): AzureTenant | undefined {
    const normalizedTenant = normalizeConfiguredTenant(configuredTenant);
    return normalizedTenant ? { tenantId: normalizedTenant, displayName: normalizedTenant, account } : undefined;
}
