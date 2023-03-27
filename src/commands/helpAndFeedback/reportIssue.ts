/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, IAzureQuickPickItem, openUrl } from "@microsoft/vscode-azext-utils";
import { commands } from "vscode";
import { AzExtWrapper, getInstalledExtensionPicks } from "../../AzExtWrapper";
import { localize } from "../../utils/localize";

export async function reportIssue(context: IActionContext): Promise<void> {
    const picks: IAzureQuickPickItem<AzExtWrapper | undefined>[] = getInstalledExtensionPicks();
    picks.push({
        label: localize('other', 'Other'),
        data: undefined
    });

    const placeHolder: string = localize('selectExtension', 'Select the Azure extension you want to report an issue on');
    const azExtension: AzExtWrapper | undefined = (await context.ui.showQuickPick(picks, { placeHolder, suppressPersistence: true })).data;
    if (azExtension) {
        context.telemetry.properties.extension = azExtension.name;
        const commandId: string | undefined = await azExtension.getReportIssueCommandId();
        if (commandId) {
            await commands.executeCommand(commandId);
        } else {
            await openNewIssuePage(azExtension.name);
        }
    } else {
        await openNewIssuePage('azcode');
    }
}

async function openNewIssuePage(extensionName: string): Promise<void> {
    await openUrl(`https://github.com/microsoft/${extensionName}/issues/new`);
}
