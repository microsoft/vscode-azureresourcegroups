/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../extensionVariables';

const ManualSignInTenantKey = 'manualSignInTenant';
let testingManualSignInTenant: string | undefined;

export function normalizeTenant(tenant: string | undefined): string | undefined {
    const trimmedTenant = tenant?.trim();
    return trimmedTenant ? trimmedTenant : undefined;
}

export function getManualSignInTenant(): string | undefined {
    if (testingManualSignInTenant !== undefined) {
        return testingManualSignInTenant;
    }

    return normalizeTenant(ext.context.globalState.get<string>(ManualSignInTenantKey));
}

export async function setManualSignInTenant(tenant: string): Promise<void> {
    if (!ext.context) {
        testingManualSignInTenant = normalizeTenant(tenant);
        return;
    }

    await ext.context.globalState.update(ManualSignInTenantKey, normalizeTenant(tenant));
}

export function getTenantIdForAuthentication(tenantId: string | undefined): string | undefined {
    return normalizeTenant(tenantId) ?? getManualSignInTenant();
}

export function resetManualSignInTenantForTests(): void {
    testingManualSignInTenant = undefined;
}
