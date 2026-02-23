/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createAzureDevOpsSubscriptionProviderFactory } from "../../src/services/AzureDevOpsSubscriptionProvider";
import { getCachedTestApi } from "./testApiAccess";

/**
 * Re-establishes the Azure DevOps subscription provider via the test API.
 *
 * The primary AzDO provider setup now happens at extension activation time
 * (see {@link getSubscriptionProviderFactory}). This helper is only needed in test
 * suites that first clear overrides (e.g. after mock-based tests) and need to
 * restore the AzDO provider for subsequent integration tests.
 */
export async function setupAzureDevOpsSubscriptionProvider(): Promise<void> {
    const factory = createAzureDevOpsSubscriptionProviderFactory();
    const provider = await factory();

    const testApi = getCachedTestApi();
    testApi.testing.setOverrideAzureSubscriptionProvider(() => provider);
}
