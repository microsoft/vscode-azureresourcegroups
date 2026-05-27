/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscriptionProvider } from "@microsoft/vscode-azext-azureauth";
import type { AzureDevOpsSubscriptionProviderInitializer } from "@microsoft/vscode-azext-azureauth/azdo";

/**
 * Reads Azure DevOps federated credential configuration from environment variables
 * and returns a factory that creates an {@link AzureDevOpsSubscriptionProvider}.
 *
 * Expected environment variables (set by the shared pipeline template in `vscode-azuretools`):
 * - `FC_SERVICE_CONNECTION_ID` — the resource ID of the ADO federated service connection
 * - `FC_SERVICE_CONNECTION_TENANT_ID` — the tenant ID of the service connection
 * - `FC_SERVICE_CONNECTION_CLIENT_ID` — the service principal (application client) ID
 *
 * The factory also calls `signIn()` on the first invocation so the provider is
 * ready to use immediately.
 */
export function createAzureDevOpsSubscriptionProviderFactory(): () => Promise<AzureSubscriptionProvider> {
    const serviceConnectionId: string | undefined = process.env['FC_SERVICE_CONNECTION_ID'] ?? process.env['AzCode_ServiceConnectionID'];
    const tenantId: string | undefined = process.env['FC_SERVICE_CONNECTION_TENANT_ID'] ?? process.env['AzCode_ServiceConnectionDomain'];
    const clientId: string | undefined = process.env['FC_SERVICE_CONNECTION_CLIENT_ID'] ?? process.env['AzCode_ServiceConnectionClientID'];

    if (!serviceConnectionId || !tenantId || !clientId) {
        throw new Error(`Using Azure DevOps federated credentials, but federated service connection is not configured\n
                            process.env.FC_SERVICE_CONNECTION_ID: ${serviceConnectionId ? "✅" : "❌"}\n
                            process.env.FC_SERVICE_CONNECTION_TENANT_ID: ${tenantId ? "✅" : "❌"}\n
                            process.env.FC_SERVICE_CONNECTION_CLIENT_ID: ${clientId ? "✅" : "❌"}\n
                        `);
    }

    const initializer: AzureDevOpsSubscriptionProviderInitializer = {
        serviceConnectionId,
        tenantId,
        clientId,
    };

    let providerPromise: Promise<AzureSubscriptionProvider> | undefined;

    return () => {
        providerPromise ??= (async () => {
            // Dynamic import so the AzDO-specific module (and its @azure/identity dependency)
            // is only loaded when federated credentials are actually in use.
            const { AzureDevOpsSubscriptionProvider } = await import("@microsoft/vscode-azext-azureauth/azdo");
            const provider = new AzureDevOpsSubscriptionProvider(initializer);
            const signedIn = await provider.signIn();
            if (!signedIn) {
                throw new Error("Azure DevOps sign-in failed during subscription provider initialization.");
            }
            return provider;
        })();
        return providerPromise;
    };
}
