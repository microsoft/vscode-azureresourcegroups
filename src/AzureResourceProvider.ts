import { GenericResource, ResourceManagementClient } from "@azure/arm-resources";
import { uiUtils } from "@microsoft/vscode-azext-azureutils";
import { callWithTelemetryAndErrorHandling, IActionContext, ISubscriptionContext } from "@microsoft/vscode-azext-utils";
import { ApplicationResourceProvider } from "./api";
import { createResourceClient } from "./utils/azureClients";

export class AzureResourceProvider implements ApplicationResourceProvider {
    public async provideResources(subContext: ISubscriptionContext): Promise<GenericResource[] | undefined> {
        return await callWithTelemetryAndErrorHandling('provideResources', async (context: IActionContext) => {

            const client: ResourceManagementClient = await createResourceClient([context, subContext]);
            // Load more currently broken https://github.com/Azure/azure-sdk-for-js/issues/20380

            const resources: GenericResource[] = await uiUtils.listAllIterator(client.resources.list());
            return resources;
        });
    }
}
