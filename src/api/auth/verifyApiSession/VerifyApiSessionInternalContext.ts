/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { AzExtCredentialManager } from "api/src/auth/credentialManager/AzExtCredentialManager";

export interface VerifyApiSessionInternalContext extends IActionContext {
    credentialManager: AzExtCredentialManager;
    clientExtensionId: string;
    azureResourcesCredential: string;
}
