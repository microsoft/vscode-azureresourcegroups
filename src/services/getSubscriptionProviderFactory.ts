import { AzureDevOpsSubscriptionProviderInitializer, AzureSubscriptionProvider, createAzureDevOpsSubscriptionProviderFactory } from "@microsoft/vscode-azext-azureauth";
import { createVSCodeAzureSubscriptionProviderFactory } from "./VSCodeAzureSubscriptionProvider";

/**
 * Returns a factory function that creates a subscription provider, satisfying the `AzureSubscriptionProvider` interface.
 *
 * If the `useAzureSubscriptionProvider` is set to `true`, an `AzureDevOpsSubscriptionProviderFactory` is returned.
 * Otherwise, a `VSCodeSubscriptionProviderFactory` is returned.
 *
 */
export function getSubscriptionProviderFactory(useAzureFederatedCredentials: boolean): () => Promise<AzureSubscriptionProvider> {
    if (useAzureFederatedCredentials) {
        const serviceConnectionId: string | undefined = process.env['AzCode_ServiceConnectionID'];
        const domain: string | undefined = process.env['AzCode_ServiceConnectionDomain'];
        const clientId: string | undefined = process.env['AzCode_ServiceConnectionClientID'];

        if (!serviceConnectionId || !domain || !clientId) {
            throw new Error(`Using Azure DevOps federated credentials, but federated service connection is not configured\n
                                process.env.AzCodeServiceConnectionID: ${serviceConnectionId ? "✅" : "❌"}\n
                                process.env.AzCodeServiceConnectionDomain: ${domain ? "✅" : "❌"}\n
                                process.env.AzCodeServiceConnectionClientID: ${clientId ? "✅" : "❌"}\n
                            `);
        }

        const initializer: AzureDevOpsSubscriptionProviderInitializer = {
            serviceConnectionId,
            domain,
            clientId,
        }
        return createAzureDevOpsSubscriptionProviderFactory(initializer);
    } else {
        return createVSCodeAzureSubscriptionProviderFactory();
    }
}
