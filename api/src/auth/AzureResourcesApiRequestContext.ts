/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureResourcesExtensionApi } from "../extensionApis";
import { AzureExtensionApi } from "../utils/apiUtils";
import { AzExtCredentialManager } from "./AzExtCredentialManager";

export interface AzureResourcesApiRequestContext {
    azureResourcesApiVersions: string[];
    clientExtensionId: string;
    clientCredentialManager: AzExtCredentialManager<unknown>;
    onDidReceiveAzureResourcesApis: (azureResourcesApis: (AzureResourcesExtensionApi | AzureExtensionApi)[]) => void | Promise<void>;
}
