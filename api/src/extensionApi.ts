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
