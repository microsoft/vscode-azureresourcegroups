/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

const genericActivityLogPrompt = vscode.l10n.t(`I'd like to ask you questions about my activity log`);

export async function askAgentAboutActivityLog() {
    await vscode.commands.executeCommand("workbench.action.chat.newEditSession");
    // await vscode.commands.executeCommand("workbench.action.chat.toggleAgentMode", { mode: 'agent' });
    await vscode.commands.executeCommand("workbench.action.chat.openEditSession", { query: genericActivityLogPrompt });
}

// const activityLogItemPrompt = vscode.l10n.t(`I'd like to learn more about activity log tree item`);

// export async function askAgentAboutActivityLogItem(context: IActionContext, item: ActivityLogTreeItem) {
//     //
// }
