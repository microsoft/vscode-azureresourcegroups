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

export async function setUnselectedTenants(tenantIds: string[]): Promise<void> {
    const deduplicated = Array.from(new Set(tenantIds));

    let str = 'Unselected tenants:\n';
    for (const tenant of deduplicated) {
        str += `- ${tenant}\n`;
    }
    ext.outputChannel.appendLine(str);

    await ext.context.globalState.update(UnselectedTenantsKey, deduplicated);
}

export function isTenantFilteredOut(tenantId: string, accountId: string): boolean {
    const settings = ext.context.globalState.get<string[]>(UnselectedTenantsKey);
    if (settings) {
        if (settings.includes(getKeyForTenant(tenantId, accountId))) {
            return true;
        }
    }
    return false;
}
