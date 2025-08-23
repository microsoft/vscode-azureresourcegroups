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
    status?: ActivityStatus;
    error?: unknown;
    activityAttributes?: ActivityAttributes;
    children?: ConvertedActivityChildItem[];
}

type ConvertedActivityChildItem = {
    label?: string;
    description?: string;
    type?: ActivityChildType;
    children?: ConvertedActivityChildItem[];
};

export async function convertActivityTreeToSimpleObjectArray(context: GetAzureActivityLogContext): Promise<ConvertedActivityItem[]> {
    const treeItems: TreeDataItem[] = await ext.activityLogTree.getChildren() ?? [];
    return (await Promise.all(treeItems.map(treeItem => convertItemToSimpleActivityObject(context, treeItem)))).filter(item => !!item) as ConvertedActivityItem[];
}

export type ExcludedActivityItem = ConvertedActivityItem & {
    /**
     * Internal flag to mark item as excluded
     */
    _exclude?: boolean;
};

async function convertItemToSimpleActivityObject(context: GetAzureActivityLogContext, item: TreeDataItem): Promise<ConvertedActivityItem | undefined> {
    if (!(item instanceof ActivityItem)) {
        return undefined;
    }

    const convertedItem: ConvertedActivityItem = {
        label: item.label,
        callbackId: item.callbackId,
        description: item.description,
        status: item.status,
        error: item.error,
        activityAttributes: item.activityAttributes,
    };

    if (context.activitySelectionCache.selectionCount && !context.activitySelectionCache.hasActivityItem(item.id)) {
        (convertedItem as ExcludedActivityItem)._exclude = true;
    }

    if (item.getChildren) {
        const children = await item.getChildren() ?? [];
        if (children.length > 0) {
            convertedItem.children = await Promise.all(children.map(child => convertItemToSimpleActivityChildObject(context, child as ActivityChildItemBase)));
        }
    }

    return convertedItem;
}

async function convertItemToSimpleActivityChildObject(context: GetAzureActivityLogContext, item: ActivityChildItemBase): Promise<ConvertedActivityChildItem> {
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
