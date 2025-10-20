/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureResourcesExtensionApi } from "../extensionApis";
import { AzureExtensionApi } from "../utils/apiUtils";
import { AzExtCredentialManager } from "./AzExtCredentialManager";
import { AzureResourcesHandshakeError } from "./errors";

export interface AzureResourcesApiRequestContext {
    azureResourcesApiVersions: string[];
    clientExtensionId: string;
    clientCredentialManager: AzExtCredentialManager<unknown>;
    /**
     * Callback invoked when the Azure Resources API(s) are successfully received after the authentication handshake.
     * @param azureResourcesApis - An array of Azure Resources Extension APIs that were successfully obtained.
     */
    onDidReceiveAzureResourcesApis: (azureResourcesApis: (AzureResourcesExtensionApi | AzureExtensionApi)[]) => void | Promise<void>;
    /**
     * Optional callback invoked when an error occurs during the Azure Resources API handshake process.
     * @param error - The error that occurred during the handshake, containing an error code and message.
     */
    onHandshakeError?: (error: AzureResourcesHandshakeError) => void | Promise<void>;
}
