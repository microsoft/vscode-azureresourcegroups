import { AzureSubscription } from "api/src/resources/azure";

/**
 * @returns `/accounts/<account id>/tenants/<tenant id>`
 */
export function getAccountAndTenantPrefix(subscription: AzureSubscription): string {
    return `/accounts/${subscription.account?.id}/tenants/${subscription.tenantId}`;
}
