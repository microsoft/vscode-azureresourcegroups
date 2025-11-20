/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureResourcesExtensionApi } from "../../extensionApi";
import { AzureExtensionApi } from "../../utils/apiUtils";
import { AzureResourcesApiRequestError } from "./apiRequestErrors";

export interface AzureResourcesApiRequestContext {
    clientExtensionId: string;
    azureResourcesApiVersions: string[];

    /**
     * Callback invoked when Azure Resource APIs are successfully obtained through the authentication handshake.
     *
     * @param azureResourcesApis - Array of APIs corresponding to the requested versions. APIs are returned in the same
     *                             order as provided in this request context. If a requested version is not
     *                             available or does not match, `undefined` will be returned at that position.
     */
    onDidReceiveAzureResourcesApis: (azureResourcesApis: (AzureResourcesExtensionApi | AzureExtensionApi | undefined)[]) => void | Promise<void>;

    /**
     * Optional callback invoked when an error occurs during the Azure Resources API handshake process.
     *
     * @remarks Errors thrown during execution of this callback may be part of a separate process and may not bubble up to users.
     * If you wish to surface specific errors to users, please consider logging them or using the VS Code API to display them through UI.
     *
     * @param error - The error that occurred during the handshake, containing an error code and message.
     */
    onApiRequestError?: (error: AzureResourcesApiRequestError) => void | Promise<void>;
}
