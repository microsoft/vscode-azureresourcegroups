/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import type { ResourcesApi } from "./resources/resourcesApi";
import { AzureExtensionApi } from "./utils/apiUtils";

/**
 * The current (v2) Azure Resources extension API.
 */
export interface AzureResourcesExtensionApi extends AzureExtensionApi {
    resources: ResourcesApi;
}

/**
 * The authentication layer (v4) protecting the Azure Resources extension API.
 */
export interface AzureResourcesExtensionAuthApi extends AzureExtensionApi {
    getAzureResourcesApi(clientExtensionId: string, azureResourceApiVersions: string[], azureResourcesCredential: string): Promise<(AzureExtensionApi | undefined)[] | undefined>;
    createAzureResourcesApiSession(clientExtensionId: string, clientExtensionVersion: string, clientExtensionCredential: string): Promise<void>;
}
