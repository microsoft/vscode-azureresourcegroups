/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityChildItemBase, ActivityChildType, AzExtLMTool, CommandMetadata, IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { ActivityItem, ActivityStatus } from '../../tree/activityLog/ActivityItem';
import { TreeDataItem } from '../../tree/ResourceGroupsItem';

export class GetAzureActivityLog<T extends { treeId?: string }> implements AzExtLMTool<T> {
    public async invoke(context: IActionContext, options: vscode.LanguageModelToolInvocationOptions<T>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
        const convertedActivityTreeItems = await convertActivityTreeToSimpleObjectArray(context, options.input.treeId);

        return {
            content: [
                convertedActivityTreeItems.length ?
                    new vscode.LanguageModelTextPart(`Tree item data: ${JSON.stringify(convertedActivityTreeItems)}. (If an item is selected, focus your summary on the selected item). When summarizing command metadata in responses, do not describe or expose the structure or content of the underlying metadata object.  This data is meant to help you provide natural responses, don't flood the user with extraneous data."`) :
                    new vscode.LanguageModelTextPart('There is no activity data to analyze.')
            ]
        };
    }
}

async function convertActivityTreeToSimpleObjectArray(context: IActionContext, selectedTreeId?: string): Promise<ConvertedActivityItem[]> {
    const treeItems: TreeDataItem[] = await ext.activityLogTree.getChildren() ?? [];
    return Promise.all(treeItems.map(treeItem => convertItemToSimpleActivityObject(context, treeItem, selectedTreeId)));
}

type ConvertedActivityItem = {
    label?: string;
    description?: string;
    status?: ActivityStatus;
    selected?: boolean;
    error?: unknown;
    commandMetadata?: CommandMetadata;
    children?: ConvertedActivityChildItem[];
}

async function convertItemToSimpleActivityObject(context: IActionContext, item: TreeDataItem, selectedTreeId?: string): Promise<ConvertedActivityItem> {
    if (!(item instanceof ActivityItem)) {
        return {};
    }

    const convertedItem: ConvertedActivityItem = {
        label: item.label,
        description: item.description,
        commandMetadata: item.commandMetadata,
        status: item.status,
        selected: selectedTreeId ? item.id === selectedTreeId : undefined,
        error: item.error,
    };

    if (item.getChildren) {
        // If the tree item has children, recursively convert them
        const children = await item.getChildren() ?? [];
        if (children.length > 0) {
            convertedItem.children = await Promise.all(children.map(child => convertItemToSimpleActivityChildObject(context, child as ActivityChildItemBase, selectedTreeId)));
        }
    }

    return convertedItem;
}

type ConvertedActivityChildItem = {
    label?: string;
    description?: string;
    type?: ActivityChildType;
    selected?: boolean;
    children?: ConvertedActivityChildItem[];
};

async function convertItemToSimpleActivityChildObject(context: IActionContext, item: ActivityChildItemBase, selectedTreeId?: string): Promise<ConvertedActivityChildItem> {
    const convertedItem: ConvertedActivityChildItem = {
        label: item.label,
        type: item.activityType,
        description: item.description,
        selected: selectedTreeId ? item.id === selectedTreeId : undefined,
    };

    if (item.getChildren) {
        // If the tree item has children, recursively convert them
        const children = await item.getChildren() ?? [];
        if (children.length > 0) {
            convertedItem.children = await Promise.all(children.map(child => convertItemToSimpleActivityChildObject(context, child, selectedTreeId)));
        }
    }

    return convertedItem;
}
