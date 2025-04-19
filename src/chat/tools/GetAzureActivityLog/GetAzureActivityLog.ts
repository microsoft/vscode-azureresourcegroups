/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtLMTool, IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ActivityLogPromptType, GetAzureActivityLogInputSchema } from './GetAzureActivityLogInputSchema';
import { convertActivityTreeToSimpleObjectArray, ConvertedActivityItem } from './convertActivityTree';

export class GetAzureActivityLog<T extends GetAzureActivityLogInputSchema> implements AzExtLMTool<T> {
    public async invoke(context: IActionContext, options: vscode.LanguageModelToolInvocationOptions<T>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
        const convertedActivityItems: ConvertedActivityItem[] = await convertActivityTreeToSimpleObjectArray(context, options.input.treeId);

        return {
            content: [
                convertedActivityItems.length ?
                    generateContextualizedPrompt(JSON.stringify(convertedActivityItems), options.input.promptType) :
                    new vscode.LanguageModelTextPart('There is no activity data to analyze.')
            ]
        };
    }
}

function generateContextualizedPrompt(treeItemData: string, promptType: ActivityLogPromptType): vscode.LanguageModelTextPart {
    switch (promptType) {
        case ActivityLogPromptType.Fix:
            return new vscode.LanguageModelTextPart(
                `Tree item data: ${treeItemData}.
                Analyze the activity log for any errors or failures. Focus on diagnosing the root cause of the issue and provide actionable steps to resolve it.
                If an item is marked as selected, prioritize your analysis on the selected item and its relationship to the top-level parent activity item.
                The top-level parent item represents the command that was run. Include any relevant context or dependencies that may have contributed to the issue.
                Avoid exposing the raw structure or content of the underlying object in your response.`
            );
        case ActivityLogPromptType.Explain:
            return new vscode.LanguageModelTextPart(
                `Tree item data: ${treeItemData}. If an item is marked as selected, focus your summary on the selected item.
                When a child item is selected, explain its relationship to the top-level parent activity item.  The top-level parent item represents the command that was run.
                When summarizing the data in responses, do not directly expose the structure or content of the underlying object.`
            );
    }

}
