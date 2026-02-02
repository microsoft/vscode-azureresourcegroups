/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { AzExtCredentialManager } from "../../../../api/src/auth/credentialManager/AzExtCredentialManager";
import { AzureExtensionApi } from "../../../../api/src/utils/apiUtils";

export interface CreateApiSessionInternalContext extends IActionContext {
    credentialManager: AzExtCredentialManager;
    clientExtensionId: string;
    clientExtensionVersion: string;
    clientExtensionCredential: string;

    /**
     * An optional API provider to be used in lieu of the VS Code API `vscode.extension.getExtension()`.
     * This should _NOT_ be defined in production environments.
     */
    clientApiProvider?: CreateApiSessionExtensionProvider;
}

export type CreateApiSessionExtensionProvider = { getApi(clientExtensionId: string, clientExtensionVersion: string): AzureExtensionApi };
