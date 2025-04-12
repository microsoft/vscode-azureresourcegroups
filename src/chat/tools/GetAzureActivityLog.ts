/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtLMTool, AzExtTreeItem, IActionContext, isAzExtParentTreeItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ActivityStatus, ActivityTreeItem } from '../../activityLog/ActivityTreeItem';
import { ext } from '../../extensionVariables';

export class GetAzureActivityLog<T extends { treeId?: string }> implements AzExtLMTool<T> {
    public async invoke(context: IActionContext, options: vscode.LanguageModelToolInvocationOptions<T>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
        const convertedActivityTreeItems = await convertActivityTreeToSimpleObjectArray(context, options.input.treeId);

        return {
            content: [
                convertedActivityTreeItems.length ?
                    new vscode.LanguageModelTextPart(`Tree item data: ${JSON.stringify(convertedActivityTreeItems)}. (If an item is selected, focus your summary on the selected item.)`) :
                    new vscode.LanguageModelTextPart('There is no activity data to analyze.')
            ]
        };
    }
}

type ConvertedActivityTreeItem = {
    label: string;
    description?: string;
    status?: ActivityStatus;
    selected?: boolean;
    error?: unknown;
    children?: ConvertedActivityTreeItem[];
}

async function convertActivityTreeToSimpleObjectArray(context: IActionContext, selectedTreeId?: string): Promise<ConvertedActivityTreeItem[]> {
    // The root tree item is not visible to the user, so we need to get its children, not it
    const treeItems = await ext.activityLogTreeItem.loadAllChildren(context);
    return Promise.all(treeItems.map(treeItem => convertTreeItemToSimpleObject(context, treeItem, selectedTreeId)));
}

async function convertTreeItemToSimpleObject(context: IActionContext, treeItem: AzExtTreeItem, selectedTreeId?: string): Promise<ConvertedActivityTreeItem> {
    const convertedItem: ConvertedActivityTreeItem = {
        label: treeItem.label,
        description: treeItem.description,
        selected: !!selectedTreeId && treeItem.id === selectedTreeId,
    };

    if (treeItem instanceof ActivityTreeItem) {
        // If the tree item is an instance of ActivityTreeItem, include its status and error
        convertedItem.status = treeItem.status;
        convertedItem.error = treeItem.error;
    }

    if (isAzExtParentTreeItem(treeItem)) {
        // If the tree item has children, recursively convert them
        const children = await treeItem.loadAllChildren(context);
        if (children.length > 0) {
            convertedItem.children = await Promise.all(children.map(child => convertTreeItemToSimpleObject(context, child, selectedTreeId)));
        }
    }

    return convertedItem;
}
