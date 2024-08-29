import { AzureDevOpsSubscriptionProviderInitializer, AzureSubscriptionProvider, createAzureDevOpsSubscriptionProviderFactory } from "@microsoft/vscode-azext-azureauth";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { createVSCodeAzureSubscriptionProviderFactory } from "./VSCodeAzureSubscriptionProvider";

/**
 * Returns a factory function that creates a subscription provider, satisfying the `AzureSubscriptionProvider` interface.
 *
 * If the `useAzureSubscriptionProvider` is set to `true`, an `AzureDevOpsSubscriptionProviderFactory` is returned.
 * Otherwise, a `VSCodeSubscriptionProviderFactory` is returned.
 *
 */
export function getSubscriptionProviderFactory(activateContext?: IActionContext): () => Promise<AzureSubscriptionProvider> {
    // if this for a nightly test, we want to use the test subscription provider
    const useAzureFederatedCredentials: boolean = !/^(false|0)?$/i.test(process.env['AzCode_UseAzureFederatedCredentials'] || '')
    if (useAzureFederatedCredentials) {
        // when running tests, ensure we throw the errors and they aren't silently swallowed
        if (activateContext) {
            activateContext.errorHandling.rethrow = useAzureFederatedCredentials;
        }

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
