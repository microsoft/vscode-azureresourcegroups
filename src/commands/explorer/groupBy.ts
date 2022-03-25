/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ext } from "../../extensionVariables";
import { settingUtils } from "../../utils/settingUtils";

export function buildGroupByCommand(setting: string) {
    return (context: IActionContext): Promise<void> => groupBy(context, setting);
}

async function groupBy(context: IActionContext, setting: string): Promise<void> {
    await settingUtils.updateGlobalSetting('groupBy', setting);
    void ext.tree.refresh(context);
}
