/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtLMTool, IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { getSelectedAzureNode } from '../../utils/usedAndSelectedResources';

export class GetSelectedAzureNode<T = never> implements AzExtLMTool<T> {
    public async invoke(_context: IActionContext, _options: vscode.LanguageModelToolInvocationOptions<T>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
        const result = await getSelectedAzureNode();

        if (result) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result)]);
        }

        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No selected Azure nodes.')]);
    }
}
