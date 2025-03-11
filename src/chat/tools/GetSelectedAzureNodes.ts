/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtLMTool, IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { getSelectedAzureNode } from '../../utils/usedAndSelectedResources';

export class GetSelectedAzureNodes<T = never> implements AzExtLMTool<T> {
    // This method is optional
    // public async prepareInvocation(_context: IActionContext, _options: vscode.LanguageModelToolInvocationPrepareOptions<T>, _token: vscode.CancellationToken): Promise<vscode.PreparedToolInvocation> {
    //     return {
    //         invocationMessage: vscode.l10n.t('Getting selected Azure nodes...'),
    //         confirmationMessages: {
    //             title: vscode.l10n.t('Are you sure?'),
    //             message: vscode.l10n.t('This will get the selected Azure nodes.'),
    //         }
    //     };
    // }

    public async invoke(_context: IActionContext, _options: vscode.LanguageModelToolInvocationOptions<T>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
        const result = await getSelectedAzureNode();

        if (result) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result)]);
        }

        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No selected Azure nodes.')]);
    }
}
