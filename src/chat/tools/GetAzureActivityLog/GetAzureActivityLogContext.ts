/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ActivitySelectionCache } from "../../askAgentAboutActivityLog/ActivitySelectionCache";

export interface GetAzureActivityLogContext extends IActionContext {
    activitySelectionCache: ActivitySelectionCache;
}
