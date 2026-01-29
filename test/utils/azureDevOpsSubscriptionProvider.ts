/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureDevOpsSubscriptionProviderInitializer, createAzureDevOpsSubscriptionProviderFactory } from "@microsoft/vscode-azext-azureauth/azdo";
import { getCachedTestApi } from "./testApiAccess";

/**
 * Sets up the Azure DevOps subscription provider for nightly tests.
 * This reads credentials from environment variables and configures the test API override.
 *
 * Required environment variables:
 * - AzCode_ServiceConnectionID: The Azure DevOps service connection ID
 * - AzCode_ServiceConnectionDomain: The tenant/domain ID
 * - AzCode_ServiceConnectionClientID: The client ID for authentication
 *
 * @throws Error if any required environment variables are missing
 */
export async function setupAzureDevOpsSubscriptionProvider(): Promise<void> {
    const serviceConnectionId: string | undefined = process.env['AzCode_ServiceConnectionID'];
    const domain: string | undefined = process.env['AzCode_ServiceConnectionDomain'];
    const clientId: string | undefined = process.env['AzCode_ServiceConnectionClientID'];

    if (!serviceConnectionId || !domain || !clientId) {
        throw new Error(`Using Azure DevOps federated credentials, but federated service connection is not configured\n
                            process.env.AzCode_ServiceConnectionID: ${serviceConnectionId ? "✅" : "❌"}\n
                            process.env.AzCode_ServiceConnectionDomain: ${domain ? "✅" : "❌"}\n
                            process.env.AzCode_ServiceConnectionClientID: ${clientId ? "✅" : "❌"}\n
                        `);
    }

    const initializer: AzureDevOpsSubscriptionProviderInitializer = {
        serviceConnectionId,
        tenantId: domain,
        clientId,
    };

    const factory = createAzureDevOpsSubscriptionProviderFactory(initializer);

    // Set the override via the test API
    const testApi = getCachedTestApi();
    testApi.testing.setOverrideAzureSubscriptionProvider(() => factory());
}
