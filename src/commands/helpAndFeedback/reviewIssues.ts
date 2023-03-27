/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, IAzureQuickPickItem, openUrl } from "@microsoft/vscode-azext-utils";
import { AzExtWrapper, getInstalledExtensionPicks } from "../../AzExtWrapper";
import { localize } from "../../utils/localize";

export async function reviewIssues(context: IActionContext): Promise<void> {
    const picks: IAzureQuickPickItem<AzExtWrapper>[] = getInstalledExtensionPicks();
    const placeHolder: string = localize('selectExtension', 'Select the Azure extension you want to review issues for');
    const azExtension: AzExtWrapper = (await context.ui.showQuickPick(picks, { placeHolder, suppressPersistence: true })).data;
    context.telemetry.properties.extension = azExtension.name;
    await openUrl(`https://github.com/microsoft/${azExtension.name}/issues`);
}
