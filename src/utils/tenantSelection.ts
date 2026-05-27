/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { ext } from '../extensionVariables';

const UnselectedTenantsKey = 'unselectedTenants';

export function getKeyForTenant(tenantId: string, accountId: string): string {
    return `${tenantId}/${accountId}`;
}

export function getUnselectedTenants(): string[] {
    const value = ext.context.globalState.get<string[]>(UnselectedTenantsKey);

    if (!value || !Array.isArray(value)) {
        return [];
    }

    // remove any duplicates
    return Array.from(new Set(value));
}

export async function setUnselectedTenants(tenantAccountKeys: string[]): Promise<void> {
    const deduplicated = Array.from(new Set(tenantAccountKeys));

    const lines: string[] = ['Unselected tenants:'];
    for (const tenantAccountKey of deduplicated) {
        lines.push(`- ${tenantAccountKey}`);
    }
    ext.outputChannel.appendLine(lines.join('\n'));

    await ext.context.globalState.update(UnselectedTenantsKey, deduplicated);
}

export function isTenantFilteredOut(tenantId: string, accountId: string): boolean {
    return getUnselectedTenants().includes(getKeyForTenant(tenantId, accountId));
}
