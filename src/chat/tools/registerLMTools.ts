/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtLMTool, IActionContext, registerLMTool } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { GetAzureActivityLog } from './GetAzureActivityLog/GetAzureActivityLog';

export function registerLMTools(): void {
    // Contextual tools
    registerLMTool('azureResources_getAzureActivityLog', new GetAzureActivityLog());

    // LM Tool: Show Tree View
    class ShowTreeViewTool implements AzExtLMTool<{ tree: import('../../lmToolTreeView').LmTreeNode }> {
        public async invoke(
            _context: IActionContext,
            options: vscode.LanguageModelToolInvocationOptions<{ tree: import('../../lmToolTreeView').LmTreeNode }>,
            _token: vscode.CancellationToken
        ): Promise<vscode.LanguageModelToolResult> {
            const tree = options.input;
            await vscode.commands.executeCommand('lmTool.showTreeView', tree);
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Tree view updated.')]);
        }
    }
    registerLMTool('lmTool_showTreeView', new ShowTreeViewTool());
}
