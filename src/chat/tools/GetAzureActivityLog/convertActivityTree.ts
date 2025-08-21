/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityAttributes, ActivityChildItemBase, ActivityChildType } from "@microsoft/vscode-azext-utils";
import { ext } from "../../../extensionVariables";
import { ActivityItem, ActivityStatus } from "../../../tree/activityLog/ActivityItem";
import { TreeDataItem } from "../../../tree/ResourceGroupsItem";
import { GetAzureActivityLogContext } from "./GetAzureActivityLogContext";

export type ConvertedActivityItem = {
    label?: string;
    callbackId?: string;
    description?: string;
    selected?: boolean;
    status?: ActivityStatus;
    error?: unknown;
    activityAttributes?: ActivityAttributes;
    children?: ConvertedActivityChildItem[];
}

type ConvertedActivityChildItem = {
    label?: string;
    description?: string;
    selected?: boolean;
    type?: ActivityChildType;
    children?: ConvertedActivityChildItem[];
};

export async function convertActivityTreeToSimpleObjectArray(context: GetAzureActivityLogContext): Promise<ConvertedActivityItem[]> {
    const treeItems: TreeDataItem[] = await ext.activityLogTree.getChildren() ?? [];
    return Promise.all(treeItems.map(treeItem => convertItemToSimpleActivityObject(context, treeItem)));
}

async function convertItemToSimpleActivityObject(context: GetAzureActivityLogContext, item: TreeDataItem): Promise<ConvertedActivityItem> {
    if (!(item instanceof ActivityItem)) {
        return {};
    }

    const convertedItem: ConvertedActivityItem = {
        label: item.label,
        callbackId: item.callbackId,
        description: item.description,
        status: item.status,
        error: item.error,
        activityAttributes: item.activityAttributes,
    };

    if (context.selectedTreeItemId && item.id === context.selectedTreeItemId) {
        convertedItem.selected = true;
        context.hasSelectedTreeItem = true;
        context.selectedTreeItemCallbackId = item.callbackId;
    }

    if (item.getChildren) {
        const children = await item.getChildren() ?? [];
        if (children.length > 0) {
            convertedItem.children = await Promise.all(children.map(child => convertItemToSimpleActivityChildObject(context, child as ActivityChildItemBase, item.callbackId)));
        }
    }

    return convertedItem;
}

async function convertItemToSimpleActivityChildObject(context: GetAzureActivityLogContext, item: ActivityChildItemBase, callbackId?: string): Promise<ConvertedActivityChildItem> {
    const convertedItem: ConvertedActivityChildItem = {
        label: item.label,
        type: item.activityType,
        description: item.description,
    };

    if (context.selectedTreeItemId && item.id === context.selectedTreeItemId) {
        convertedItem.selected = true;
        context.hasSelectedTreeItem = true;
        context.selectedTreeItemCallbackId = callbackId;
    }

    if (item.getChildren) {
        // If there are more children, recursively convert them
        const children = await item.getChildren() ?? [];
        if (children.length > 0) {
            convertedItem.children = await Promise.all(children.map(child => convertItemToSimpleActivityChildObject(context, child, callbackId)));
        }
    }

    return convertedItem;
}
