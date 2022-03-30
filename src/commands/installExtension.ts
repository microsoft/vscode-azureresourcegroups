/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { DialogResponses, IActionContext } from "@microsoft/vscode-azext-utils";
import { commands, MessageItem, window } from "vscode";
import { getAzureExtensions } from "../AzExtWrapper";
import { ext } from "../extensionVariables";
import { localize } from "../utils/localize";

export async function installExtension(context: IActionContext, extensionId: string): Promise<void> {
    context.telemetry.properties.extensionId = extensionId;
    await commands.executeCommand('extension.open', extensionId);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const extension = getAzureExtensions().find(azExt => azExt.id === extensionId)!;
    const installMessageItem: MessageItem = {
        title: localize('installExtension', 'Install extension')
    }
    // Use extension-specific message later
    const result = await window.showInformationMessage(localize('installExtension', "Install the '{0}' extension to enable additional features?", extension.label), {
        modal: true
    }, installMessageItem, DialogResponses.cancel);

    if (result === installMessageItem) {
        context.errorHandling.suppressDisplay = true;
        // Will prompt if settings sync is enabled
        await commands.executeCommand('workbench.extensions.installExtension', extensionId);
        context.telemetry.properties.result = 'Succeeded';
        void ext.tree.refresh(context);
    } else {
        context.telemetry.properties.result = 'Canceled';
    }
}
