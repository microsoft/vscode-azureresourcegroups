/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { Activity } from "@microsoft/vscode-azext-utils";
import { ext } from "../extensionVariables";

export async function registerActivity(activity: Activity): Promise<void> {
    await ext.activityLogTreeItem.addActivity(activity);
}
