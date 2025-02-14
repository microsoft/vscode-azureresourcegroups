/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";

export async function askAzureInCommandPalette(context: IActionContext) {
    const prompt = await context.ui.showInputBox({ prompt: vscode.l10n.t(`What do you want to ask about Azure?`) });
    await vscode.commands.executeCommand("workbench.action.chat.newChat");
    await vscode.commands.executeCommand("workbench.action.chat.open", { query: `@azure ${prompt}` });
}
