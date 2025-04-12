/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerLMTool } from '@microsoft/vscode-azext-utils';
import { CreateResourceGroup } from './CreateResourceGroup';
import { GetAzureActivityLog } from './GetAzureActivityLog';
import { GetSelectedAzureNode } from './GetSelectedAzureNode';

export function registerLMTools(): void {
    // Contextual tools
    registerLMTool('azureResources_getSelectedAzureNode', new GetSelectedAzureNode());
    registerLMTool('azureResources_getAzureActivityLog', new GetAzureActivityLog());

    // Functional tools
    registerLMTool('azureResources_createResourceGroup', new CreateResourceGroup());
}
