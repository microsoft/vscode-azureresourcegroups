/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { commands } from "vscode";

export async function installExtension(context: IActionContext, extensionId: string): Promise<void> {
    context.telemetry.properties.extensionId = extensionId;
    await commands.executeCommand('extension.open', extensionId);
}
