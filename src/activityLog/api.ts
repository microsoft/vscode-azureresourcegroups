/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { Activity } from "@microsoft/vscode-azext-utils/hostapi";
import { ext } from "../extensionVariables";

export async function registerActivity(activity: Activity): Promise<void> {
    await ext.activityLogTreeItem.addActivity(activity);
}

export async function getActivities(): Promise<AzExtTreeItem[] | undefined> {
    return await callWithTelemetryAndErrorHandling('getActivities', async (context) => {
        return await ext.activityLogTreeItem.loadMoreChildrenImpl(false, context);
    });
}
