/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { uiUtils } from "@microsoft/vscode-azext-azureutils";
import { createSubscriptionContext, IActionContext, nonNullProp, subscriptionExperience } from "@microsoft/vscode-azext-utils";
import { QuickPickItem } from "vscode";
import { AzureSubscription } from "../../../api/src/index";
import { ext } from "../../extensionVariables";
import { createResourceClient } from "../../utils/azureClients";
import { localize } from "../../utils/localize";
import { settingUtils } from "../../utils/settingUtils";

export function buildGroupByCommand(setting: string) {
    return (context: IActionContext): Promise<void> => groupBy(context, setting);
}

async function groupBy(context: IActionContext, setting: string): Promise<void> {
    if (setting === 'armTag') {
        const subscription = await subscriptionExperience(context, ext.v2.api.resources.azureResourceTreeDataProvider);
        const tag = await context.ui.showQuickPick(getQuickPicks(context, subscription), {
            placeHolder: localize('groupByArmTagKey', 'Select the tag key to group by...'),
            loadingPlaceHolder: localize('loadingTags', 'Loading tags...'),
        });
        setting += `-${tag.label}`;
    }

    await settingUtils.updateGlobalSetting('groupBy', setting);
}

async function getQuickPicks(context: IActionContext, subscription: AzureSubscription): Promise<QuickPickItem[]> {
    const client = await createResourceClient([context, createSubscriptionContext(subscription)]);
    const tags = await uiUtils.listAllIterator(client.tagsOperations.list());
    return tags.map(tag => ({
        label: nonNullProp(tag, 'tagName'),
    }));
}

export enum GroupBySettings {
    ResourceGroup = 'resourceGroup',
    ResourceType = 'resourceType',
    Location = 'location'
}
