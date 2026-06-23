/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export const azureTenantSettingKey = 'azure.tenant';

export function normalizeConfiguredTenant(tenant: string | undefined): string | undefined {
    const trimmedTenant = tenant?.trim();
    return trimmedTenant ? trimmedTenant : undefined;
}

export function getConfiguredAzureTenant(): string | undefined {
    return normalizeConfiguredTenant(vscode.workspace.getConfiguration().get<string>(azureTenantSettingKey));
}

export function addConfiguredTenantScope(scopes: readonly string[], tenant: string | undefined = getConfiguredAzureTenant()): string[] {
    const normalizedTenant = normalizeConfiguredTenant(tenant);
    if (!normalizedTenant) {
        return [...scopes];
    }

    return Array.from(new Set([...scopes, `VSCODE_TENANT:${normalizedTenant}`]));
}
