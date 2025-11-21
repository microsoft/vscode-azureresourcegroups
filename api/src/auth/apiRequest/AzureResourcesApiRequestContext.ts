/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureResourcesExtensionApi, AzureResourcesExtensionAuthApi } from "../../extensionApi";
import { AzureExtensionApi } from "../../utils/apiUtils";
import { AzExtCredentialManager } from "../credentialManager/AzExtCredentialManager";
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

// NOTE: Dependency injection options for tests; skip publically exporting this in the index
export interface CustomRequestDependenciesContext extends AzureResourcesApiRequestContext {
    /**
     * An optional credential manager used for issuing and verifying the client extensions credentials. If none are supplied, a simple UUID credential manager is used.
     * @test Use this to more easily mock and inspect the behavior of the underlying credential manager.
     */
    credentialManager?: AzExtCredentialManager;

    /**
     * An optional API provider to be used in lieu of the VS Code extension provider `vscode.extension.getExtension()`.
     * This should _NOT_ be used in production environments.
     * @test Use this to more easily mock and inject custom host extension API exports.
     */
    hostApiProvider?: { getApi(): AzureResourcesExtensionAuthApi };
}
