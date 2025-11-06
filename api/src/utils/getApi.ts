/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { AzureResourcesExtensionApi } from '../extensionApi';
import { apiUtils, GetApiOptions } from "./apiUtils";

/**
 * @deprecated The Azure Resources core API should be accessed through the new auth layer.
 * See: https://github.com/microsoft/vscode-azureresourcegroups/blob/main/api/src/auth/README.md
 * */
export async function getAzureResourcesExtensionApi(extensionContext: vscode.ExtensionContext, apiVersionRange: '2.0.0', options?: GetApiOptions): Promise<AzureResourcesExtensionApi> {
    return apiUtils.getAzureExtensionApi<AzureResourcesExtensionApi>(extensionContext, 'ms-azuretools.vscode-azureresourcegroups', apiVersionRange, options);
}
