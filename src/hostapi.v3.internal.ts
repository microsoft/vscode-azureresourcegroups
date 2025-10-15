/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureResourcesExtensionAuthApi } from "../api/src/index";
import { AzureResourcesApiInternal } from "./hostapi.v2.internal";

export interface AzureResourcesAuthApiInternal extends AzureResourcesExtensionAuthApi {
    // Should remain identical to the parent interface, except that the return type points to the Resource Groups internal API type
    getAzureResourcesApi(clientExtensionId: string, azureResourcesToken: string): Promise<AzureResourcesApiInternal | undefined>;
}
