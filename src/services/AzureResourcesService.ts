import { GenericResource, ResourceGroup, ResourceManagementClient } from "@azure/arm-resources";
import { getSessionFromVSCode } from "@microsoft/vscode-azext-azureauth";
import { uiUtils } from "@microsoft/vscode-azext-azureutils";
import { createCredential } from "@microsoft/vscode-azext-utils";
import { AzureSubscription } from "api/src/resources/azure";
import { ext } from "../extensionVariables";

export interface AzureResourcesService {
    listResources(subscription: AzureSubscription): Promise<GenericResource[]>;
    listResourceGroups(subscription: AzureSubscription): Promise<ResourceGroup[]>;
}

export const defaultAzureResourcesServiceFactory = (): AzureResourcesService => {
    async function createClient(subscription: AzureSubscription): Promise<ResourceManagementClient> {
        const session = await getSessionFromVSCode("https://management.azure.com//.default", subscription.tenantId, { createIfNone: false, silent: true, account: subscription.account })
        const credential = createCredential(() => session);
        const client = new ResourceManagementClient(credential, subscription.subscriptionId);

        return client;
    }
    return {
        async listResources(subscription: AzureSubscription): Promise<GenericResource[]> {
            const client = await createClient(subscription);
            return uiUtils.listAllIterator(client.resources.list());
        },
        async listResourceGroups(subscription: AzureSubscription): Promise<ResourceGroup[]> {
            const client = await createClient(subscription);
            return uiUtils.listAllIterator(client.resourceGroups.list());
        },
    }
}

export type AzureResourcesServiceFactory = () => AzureResourcesService;

export function getAzureResourcesService(): AzureResourcesService {
    return ext.testing.overrideAzureServiceFactory?.() ?? defaultAzureResourcesServiceFactory();
}
