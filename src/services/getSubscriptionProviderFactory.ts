/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscriptionProvider } from "@microsoft/vscode-azext-azureauth";
import { createVSCodeAzureSubscriptionProviderFactory } from "./VSCodeAzureSubscriptionProvider";

/**
 * Returns a factory function that creates a subscription provider, satisfying the `AzureSubscriptionProvider` interface.
 *
 * For nightly tests that require Azure DevOps federated credentials, use the test API to set
 * `ext.testing.overrideAzureSubscriptionProvider` with an AzDO provider factory instead.
 */
export function getSubscriptionProviderFactory(): () => Promise<AzureSubscriptionProvider> {
    return createVSCodeAzureSubscriptionProviderFactory();
}
