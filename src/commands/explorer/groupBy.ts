/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { QuickPickItem } from "vscode";
import { getArmTagKeys } from "../../utils/azureUtils";
import { localize } from "../../utils/localize";
import { settingUtils } from "../../utils/settingUtils";

export function buildGroupByCommand(setting: string) {
    return (context: IActionContext): Promise<void> => groupBy(context, setting);
}

async function groupBy(context: IActionContext, setting: string): Promise<void> {
    if (setting === 'armTag') {
        const tag = await context.ui.showQuickPick(getQuickPicks(context), {
            placeHolder: localize('groupByArmTagKey', 'Select the tag key to group by...')
        });
        setting += `-${tag.label}`;
    }

    await settingUtils.updateGlobalSetting('groupBy', setting);
}

async function getQuickPicks(context: IActionContext): Promise<QuickPickItem[]> {
    return Array.from((await getArmTagKeys(context))).map(key => { return { label: key } })
}

export enum GroupBySettings {
    ResourceGroup = 'resourceGroup',
    ResourceType = 'resourceType',
    Location = 'location'
}
