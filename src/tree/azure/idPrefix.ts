import { AzureSubscription } from "api/src/resources/azure";

export function createAzureIdPrefix(subscription: AzureSubscription): string {
    return `/account/${subscription.account?.id}/tenant/${subscription.tenantId}`;
}
