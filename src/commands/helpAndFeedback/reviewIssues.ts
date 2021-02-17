/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { env, Uri } from "vscode";
import { IActionContext, IAzureQuickPickItem } from "vscode-azureextensionui";
import { AzExtWrapper, getInstalledExtensionPicks } from "../../AzExtWrapper";
import { ext } from "../../extensionVariables";
import { localize } from "../../utils/localize";

export async function reviewIssues(context: IActionContext): Promise<void> {
    const picks: IAzureQuickPickItem<AzExtWrapper>[] = getInstalledExtensionPicks();
    const placeHolder: string = localize('selectExtension', 'Select the Azure extension you want to review issues for');
    const azExtension: AzExtWrapper = (await ext.ui.showQuickPick(picks, { placeHolder, suppressPersistence: true })).data;
    context.telemetry.properties.extension = azExtension.name;
    await env.openExternal(Uri.parse(`https://github.com/microsoft/${azExtension.name}/issues`));
}
