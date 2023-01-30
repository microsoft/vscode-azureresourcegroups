/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

<<<<<<< HEAD
=======
import type { ActivityApi } from "./activity";
>>>>>>> 4c48d43 (Create package for consuming extension API (#530))
import type { ResourcesApi } from "./resources/resourcesApi";
import { AzureExtensionApi } from "./utils/apiUtils";

/**
 * The current (v2) Azure Resources extension API.
 */
export interface AzureResourcesExtensionApi extends AzureExtensionApi {
<<<<<<< HEAD
=======
    activity: ActivityApi;
>>>>>>> 4c48d43 (Create package for consuming extension API (#530))
    resources: ResourcesApi;
}
