/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerLMTool } from '@microsoft/vscode-azext-utils';
import { GetAzureActivityLog } from './GetAzureActivityLog';

export function registerLMTools(): void {
    // Contextual tools
    registerLMTool('azureResources_getAzureActivityLog', new GetAzureActivityLog());

    // Functional tools
}
