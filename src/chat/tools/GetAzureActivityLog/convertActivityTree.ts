/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityChildItemBase, ActivityChildType, IActionContext } from "@microsoft/vscode-azext-utils";
import { ext } from "../../../extensionVariables";
import { ActivityItem, ActivityStatus } from "../../../tree/activityLog/ActivityItem";
import { TreeDataItem } from "../../../tree/ResourceGroupsItem";

export type ConvertedActivityItem = {
    label?: string;
    description?: string;
    status?: ActivityStatus;
    selected?: boolean;
    error?: unknown;
    children?: ConvertedActivityChildItem[];
}

type ConvertedActivityChildItem = {
    label?: string;
    description?: string;
    type?: ActivityChildType;
    selected?: boolean;
    children?: ConvertedActivityChildItem[];
};

export async function convertActivityTreeToSimpleObjectArray(context: IActionContext, selectedTreeId?: string): Promise<ConvertedActivityItem[]> {
    const treeItems: TreeDataItem[] = await ext.activityLogTree.getChildren() ?? [];
    return Promise.all(treeItems.map(treeItem => convertItemToSimpleActivityObject(context, treeItem, selectedTreeId)));
}

async function convertItemToSimpleActivityObject(context: IActionContext, item: TreeDataItem, selectedTreeId?: string): Promise<ConvertedActivityItem> {
    if (!(item instanceof ActivityItem)) {
        return {};
    }

    const convertedItem: ConvertedActivityItem = {
        label: item.label,
        description: item.description,
        status: item.status,
        selected: selectedTreeId ? item.id === selectedTreeId : undefined,
        error: item.error,
    };

    if (item.getChildren) {
        const children = await item.getChildren() ?? [];
        if (children.length > 0) {
            convertedItem.children = await Promise.all(children.map(child => convertItemToSimpleActivityChildObject(context, child as ActivityChildItemBase, selectedTreeId)));
        }
    }

    return convertedItem;
}

async function convertItemToSimpleActivityChildObject(context: IActionContext, item: ActivityChildItemBase, selectedTreeId?: string): Promise<ConvertedActivityChildItem> {
    const convertedItem: ConvertedActivityChildItem = {
        label: item.label,
        type: item.activityType,
        description: item.description,
        selected: selectedTreeId ? item.id === selectedTreeId : undefined,
    };

    if (item.getChildren) {
        // If there are more children, recursively convert them
        const children = await item.getChildren() ?? [];
        if (children.length > 0) {
            convertedItem.children = await Promise.all(children.map(child => convertItemToSimpleActivityChildObject(context, child, selectedTreeId)));
        }
    }

    return convertedItem;
}
