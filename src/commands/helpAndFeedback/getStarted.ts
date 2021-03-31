/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, IAzureQuickPickItem } from "vscode-azureextensionui";
import { AzExtWrapper, getAzureExtensions } from "../../AzExtWrapper";
import { ext } from "../../extensionVariables";
import { localize } from "../../utils/localize";
import { nonNullProp } from "../../utils/nonNull";
import { openUrl } from '../../utils/openUrl';

export async function getStarted(context: IActionContext): Promise<void> {
    const azExtensions: AzExtWrapper[] = getAzureExtensions();

    let picks: IAzureQuickPickItem<AzExtWrapper>[] = [];
    for (const azExt of azExtensions) {
        if (azExt.tutorial) {
            picks.push({
                label: azExt.tutorial.label,
                description: `Azure ${azExt.label}`,
                data: azExt
            });
        }
    }
    picks = picks.sort((a, b) => a.label.localeCompare(b.label));

    const placeHolder: string = localize('selectExtension', 'Select a getting started scenario');
    const extension: AzExtWrapper = (await ext.ui.showQuickPick(picks, { placeHolder, suppressPersistence: true })).data;
    context.telemetry.properties.extension = extension.name;
    await openUrl(nonNullProp(extension, 'tutorial').url);
}
