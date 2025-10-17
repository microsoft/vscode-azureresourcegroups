/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ActivitySelectedCache } from "../../askAgentAboutActivityLog/ActivitySelectedCache";

export interface GetAzureActivityLogContext extends IActionContext {
    activitySelectedCache: ActivitySelectedCache;
}
