import { AzureSubscription } from "api/src/resources/azure";

export function createAzureIdPrefix(subscription: AzureSubscription): string {
    return `/accounts/${subscription.account?.id}/tenants/${subscription.tenantId}`;
}
