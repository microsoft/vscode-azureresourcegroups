/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscriptionProvider } from "@microsoft/vscode-azext-azureauth";
import { createAzureDevOpsSubscriptionProviderFactory } from "./AzureDevOpsSubscriptionProvider";
import { createVSCodeAzureSubscriptionProviderFactory } from "./VSCodeAzureSubscriptionProvider";

/**
 * Returns a factory function that creates a subscription provider, satisfying the `AzureSubscriptionProvider` interface.
 *
 * When running in an Azure DevOps pipeline with federated credentials enabled
 * (via the `AzCode_UseAzureFederatedCredentials` environment variable), this returns an
 * {@link AzureDevOpsSubscriptionProvider}-based factory so that client extensions that depend
 * on the Resources extension API also get the correct subscription provider without needing
 * to set it up themselves.
 */
export function getSubscriptionProviderFactory(): () => Promise<AzureSubscriptionProvider> {
    const useAzureFederatedCredentials = !/^(false|0)?$/i.test(process.env['AzCode_UseAzureFederatedCredentials'] || '');
    if (useAzureFederatedCredentials) {
        return createAzureDevOpsSubscriptionProviderFactory();
    }

    return createVSCodeAzureSubscriptionProviderFactory();
}
