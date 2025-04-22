/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityChildItemBase, ActivityChildType, CommandMetadata, IActionContext } from "@microsoft/vscode-azext-utils";
import { ext } from "../../../extensionVariables";
import { ActivityItem, ActivityStatus } from "../../../tree/activityLog/ActivityItem";
import { TreeDataItem } from "../../../tree/ResourceGroupsItem";

export type ConvertedActivityItem = {
    label?: string;
    description?: string;
    status?: ActivityStatus;
    error?: unknown;
    commandMetadata?: CommandMetadata;
    children?: ConvertedActivityChildItem[];
}

type ConvertedActivityChildItem = {
    label?: string;
    description?: string;
    type?: ActivityChildType;
    children?: ConvertedActivityChildItem[];
};

export async function convertActivityTreeToSimpleObjectArray(context: IActionContext): Promise<ConvertedActivityItem[]> {
    const treeItems: TreeDataItem[] = await ext.activityLogTree.getChildren() ?? [];
    return Promise.all(treeItems.map(treeItem => convertItemToSimpleActivityObject(context, treeItem)));
}

async function convertItemToSimpleActivityObject(context: IActionContext, item: TreeDataItem): Promise<ConvertedActivityItem> {
    if (!(item instanceof ActivityItem)) {
        return {};
    }

    const convertedItem: ConvertedActivityItem = {
        label: item.label,
        description: item.description,
        status: item.status,
        error: item.error,
        commandMetadata: item.commandMetadata,
    };

    if (item.getChildren) {
        const children = await item.getChildren() ?? [];
        if (children.length > 0) {
            convertedItem.children = await Promise.all(children.map(child => convertItemToSimpleActivityChildObject(context, child as ActivityChildItemBase)));
        }
    }

    return convertedItem;
}

async function convertItemToSimpleActivityChildObject(context: IActionContext, item: ActivityChildItemBase): Promise<ConvertedActivityChildItem> {
    const convertedItem: ConvertedActivityChildItem = {
        label: item.label,
        type: item.activityType,
        description: item.description,
    };

    if (item.getChildren) {
        // If there are more children, recursively convert them
        const children = await item.getChildren() ?? [];
        if (children.length > 0) {
            convertedItem.children = await Promise.all(children.map(child => convertItemToSimpleActivityChildObject(context, child)));
        }
    }

    return convertedItem;
}
