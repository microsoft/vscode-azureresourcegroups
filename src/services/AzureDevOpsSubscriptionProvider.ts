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
 * - `AzCode_ServiceConnectionID` — the resource ID of the ADO federated service connection
 * - `AzCode_ServiceConnectionDomain` — the tenant ID of the service connection
 * - `AzCode_ServiceConnectionClientID` — the service principal (application client) ID
 *
 * The factory also calls `signIn()` on the first invocation so the provider is
 * ready to use immediately.
 */
export function createAzureDevOpsSubscriptionProviderFactory(): () => Promise<AzureSubscriptionProvider> {
    const serviceConnectionId = process.env['AzCode_ServiceConnectionID'] ?? '';
    const tenantId = process.env['AzCode_ServiceConnectionDomain'] ?? '';
    const clientId = process.env['AzCode_ServiceConnectionClientID'] ?? '';

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
            await provider.signIn();
            return provider;
        })();
        return providerPromise;
    };
}
