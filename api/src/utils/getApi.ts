/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { AzureResourcesExtensionApi } from '../extensionApi';
import { apiUtils, GetApiOptions } from "./apiUtils";

export async function getAzureResourcesExtensionApi(extensionContext: vscode.ExtensionContext, apiVersionRange: '2.0.0', options?: GetApiOptions): Promise<AzureResourcesExtensionApi> {
    return apiUtils.getAzureExtensionApi<AzureResourcesExtensionApi>(extensionContext, 'ms-azuretools.vscode-azureresourcegroups', apiVersionRange, options);
}
