/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureExtensionApi } from "api/src";
import { AzureResourcesApiInternal } from "../hostapi.v2.internal";

export interface AzureResourcesAuthApi extends AzureExtensionApi {
    createAzExtResourcesSession(clientExtensionId: string, clientExtensionVersion: string, clientExtensionToken: string): Promise<string | void>;
    getAzExtResourcesApi(azExtResourcesToken: string, azExtResourcesApiVersion?: string): Promise<AzureResourcesApiInternal | undefined>;
}
