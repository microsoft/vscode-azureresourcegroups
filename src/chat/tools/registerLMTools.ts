/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerLMTool } from '@microsoft/vscode-azext-utils';
import { GetSelectedAzureNodes } from './GetSelectedAzureNodes';

export function registerLMTools(): void {
    registerLMTool('azureResources_getSelectedAzureNodes', new GetSelectedAzureNodes());
}
