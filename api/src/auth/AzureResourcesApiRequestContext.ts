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
     * Callback invoked when Azure Resources APIs are successfully obtained during the authentication handshake.
     *
     * @param azureResourcesApis - Array of APIs corresponding to the requested versions. APIs are returned in the same
     *                             order as specified in `azureResourcesApiVersions`. If a requested version is not
     *                             available, `undefined` is returned at that position.
     */
    onDidReceiveAzureResourcesApis: (azureResourcesApis: (AzureResourcesExtensionApi | AzureExtensionApi | undefined)[]) => void | Promise<void>;

    /**
     * Optional callback invoked when an error occurs during the Azure Resources API handshake process.
     * @param error - The error that occurred during the handshake, containing an error code and message.
     */
    onHandshakeError?: (error: AzureResourcesHandshakeError) => void | Promise<void>;
}
