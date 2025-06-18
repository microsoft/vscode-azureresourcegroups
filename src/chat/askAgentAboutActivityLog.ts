/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

const genericActivityLogPrompt: string = vscode.l10n.t('Help explain important information from my Azure activity log.');

export async function askAgentAboutActivityLog(): Promise<void> {
    await vscode.commands.executeCommand("workbench.action.chat.open");
    await vscode.commands.executeCommand("workbench.action.chat.newChat");
    await vscode.commands.executeCommand("workbench.action.chat.open", { mode: 'agent', query: genericActivityLogPrompt });
}
