/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { CopilotUserInput, executeCommandWithAddedContext, type IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { ActivitySelectedCache } from "../chat/askAgentAboutActivityLog/ActivitySelectedCache";
import { convertActivityTreeToSimpleObjectArray, ConvertedActivityItem } from "../chat/tools/GetAzureActivityLog/convertActivityTree";
import { GetAzureActivityLogContext } from "../chat/tools/GetAzureActivityLog/GetAzureActivityLogContext";
import { ActivityItem } from "../tree/activityLog/ActivityItem";

export async function reRunWithCopilot(context: IActionContext, item: ActivityItem): Promise<void> {
    const activitySelectedCache = ActivitySelectedCache.getInstance();
    activitySelectedCache.addActivity(item.id);

    const activityContext: GetAzureActivityLogContext = {
        ...context,
        activitySelectedCache: activitySelectedCache
    }

    const activityItems: ConvertedActivityItem[] = await convertActivityTreeToSimpleObjectArray(activityContext);
    context.ui = new CopilotUserInput(vscode, JSON.stringify(activityItems));

    // An item will always be passed in so we will only need to look at the first item in the array
    const callbackId = activityItems[0]?.callbackId;
    if (callbackId) {
        await executeCommandWithAddedContext(callbackId, context)
    } else {
        throw new Error(vscode.l10n.t('Failed to rerun with Copilot. Activity item callback ID not found.'));
    }
}
