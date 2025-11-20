/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureSubscriptionProvider } from "@microsoft/vscode-azext-azureauth";
import { AzExtTreeDataProvider, UIExtensionVariables } from "@microsoft/vscode-azext-utils";
import { AzureResourcesApiInternal } from "./hostapi.v2.internal";
import { AzureResourcesServiceFactory } from "./services/AzureResourcesService";

/**
 * Test-only API for accessing internal extension state.
 * This API is only available when VSCODE_RUNNING_TESTS environment variable is set.
 * It should NEVER be used in production code.
 */
export interface TestApi {
    /**
     * API version for the test API
     */
    apiVersion: '99.0.0';

    /**
     * UI extension variables often used for registration in AzExt shared packages
     */
    extVars: UIExtensionVariables;

    /**
     * Get the extension's internal API instance
     */
    getApi(): AzureResourcesApiInternal;

    /**
     * Get compatibility tree providers for v1 API tests
     */
    compatibility: {
        /**
         * Get the app resource tree (v1 compatibility)
         */
        getAppResourceTree(): AzExtTreeDataProvider;
    };

    /**
     * Testing utilities for mocking Azure services
     */
    testing: {
        /**
         * Override the Azure service factory for testing
         */
        setOverrideAzureServiceFactory(factory: AzureResourcesServiceFactory | undefined): void;

        /**
         * Override the Azure subscription provider for testing
         */
        setOverrideAzureSubscriptionProvider(provider: (() => AzureSubscriptionProvider) | undefined): void;
    };
}
