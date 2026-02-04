/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureSubscription } from "api/src/resources/azure";

/**
 * @returns `/accounts/<account id>/tenants/<tenant id>`
 */
export function getAccountAndTenantPrefix(subscription: AzureSubscription): string {
    return `/accounts/${subscription.account?.id}/tenants/${subscription.tenantId}`;
}
