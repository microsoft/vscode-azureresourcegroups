/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtLMTool, IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ActivityStatus, ActivityTreeItem } from '../../activityLog/ActivityTreeItem';
import { ext } from '../../extensionVariables';

type ConvertedActivityTreeItem = {
    label: string;
    description?: string;
    status?: ActivityStatus;
    error?: unknown;
    children?: { label: string; description?: string; }[];
}

export class GetAzureActivityLog implements AzExtLMTool<void> {
    public async invoke(context: IActionContext, _options: vscode.LanguageModelToolInvocationOptions<void>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
        const treeItems = await ext.activityLogTreeItem.loadAllChildren(context) as ActivityTreeItem[];

        const convertedItems: ConvertedActivityTreeItem[] = [];

        for (const treeItem of treeItems) {
            const convertedItem: ConvertedActivityTreeItem = {
                label: treeItem.label,
                description: treeItem.description,
                status: treeItem.status,
                error: treeItem.error,
                children: (await treeItem.loadAllChildren(context)).map(child => { return { label: child.label, description: child.description, } })
            };
            convertedItems.push(convertedItem);
        }

        // For now, return the converted items as a single JSON string
        // Due to https://github.com/microsoft/vscode-copilot/issues/14276
        // return {
        //     content: convertedItems
        //         .map(item => new vscode.LanguageModelTextPart(JSON.stringify(item))),
        // };

        return {
            content: [new vscode.LanguageModelTextPart(JSON.stringify(convertedItems))],
        };
    }
}
