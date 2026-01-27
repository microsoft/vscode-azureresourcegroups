/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureSubscriptionProvider } from "@microsoft/vscode-azext-azureauth";
import type { AzExtLocation } from "@microsoft/vscode-azext-azureutils";
import { AzExtTreeDataProvider, IActionContext, IAzExtLogOutputChannel, ISubscriptionActionContext } from "@microsoft/vscode-azext-utils";
import { GroupingKind } from "./extensionVariables";
import { AzureResourcesApiInternal } from "./hostapi.v2.internal";
import { AzureResourcesServiceFactory } from "./services/AzureResourcesService";
import { SubscriptionItem } from "./tree/azure/SubscriptionItem";

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
     * Get extension variables for tests
     */
    extensionVariables: {
        /**
         * Get the output channel
         */
        getOutputChannel(): IAzExtLogOutputChannel;
        /**
         * Get the focused group
         */
        getFocusedGroup(): GroupingKind | undefined;
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

        /**
         * Gets Azure locations
         */
        getLocations(context: ISubscriptionActionContext): Promise<AzExtLocation[]>;

        /**
         * Creates a resource group (inputs come from TestUserInput)
         */
        createResourceGroup(context: IActionContext, node: SubscriptionItem): Promise<void>;

        /**
         * Deletes a resource group (inputs come from TestUserInput)
         */
        deleteResourceGroupV2(context: IActionContext): Promise<void>;

        /**
         * Checks if a resource group exists
         */
        resourceGroupExists(context: IActionContext, node: SubscriptionItem, rgName: string): Promise<boolean>;
    };
}
