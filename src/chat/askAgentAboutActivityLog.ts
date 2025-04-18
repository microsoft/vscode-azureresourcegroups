/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";

const activityLogTool: string = 'azureActivityLog';
const genericActivityLogPrompt: string = vscode.l10n.t(`Help me understand important information in my VS Code activity log.`);

export async function askAgentAboutActivityLog(): Promise<void> {
    await vscode.commands.executeCommand("workbench.action.chat.newChat");
    await vscode.commands.executeCommand("workbench.action.chat.open", { query: `#${activityLogTool} ${genericActivityLogPrompt}` });
}

export async function askAgentAboutActivityLogItem(_: IActionContext, node?: AzExtTreeItem): Promise<void> {
    if (!node) {
        return await askAgentAboutActivityLog();
    }
    await vscode.commands.executeCommand("workbench.action.chat.newChat");
    await vscode.commands.executeCommand("workbench.action.chat.open", { query: `#${activityLogTool} ${genericActivityLogPrompt} I'm interested in learning more about the activity item with treeId: ${node.id}.` });
}
