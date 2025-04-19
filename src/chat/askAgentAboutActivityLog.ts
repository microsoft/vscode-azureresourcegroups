/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityChildItemBase, IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { ActivityItem } from "../tree/activityLog/ActivityItem";
import { ActivityLogPromptType } from "./tools/GetAzureActivityLog/GetAzureActivityLogInputSchema";

export async function askAgentAboutActivityLog(): Promise<void> {
    await vscode.commands.executeCommand("workbench.action.chat.newChat");
    await vscode.commands.executeCommand("workbench.action.chat.open", { query: generateActivityLogPrompt(ActivityLogPromptType.Explain) });
}

export async function askAgentAboutActivityLogItem(_: IActionContext, promptType: ActivityLogPromptType, node?: ActivityItem | ActivityChildItemBase): Promise<void> {
    if (!node) {
        return await askAgentAboutActivityLog();
    }
    await vscode.commands.executeCommand("workbench.action.chat.newChat");
    await vscode.commands.executeCommand("workbench.action.chat.open", { query: generateActivityLogPrompt(promptType, node.id) });
}

const activityLogTool: string = 'azureActivityLog';
const explainActivityLogPrompt: string = vscode.l10n.t('Help explain the important information in my VS Code activity log.');
const fixActivityItemPrompt: string = vscode.l10n.t('Help me diagnose and fix the error in my VS Code activity log.');

function generateActivityLogPrompt(promptType: ActivityLogPromptType, treeId?: string): string {
    switch (promptType) {
        case ActivityLogPromptType.Fix:
            return treeId ?
                `#${activityLogTool} ${fixActivityItemPrompt} I'm interested in the activity item with treeId: ${treeId}.` :
                `#${activityLogTool} ${fixActivityItemPrompt}`;
        case ActivityLogPromptType.Explain:
            return treeId ?
                `#${activityLogTool} ${explainActivityLogPrompt} I'm interested in the activity item with treeId: ${treeId}.` :
                `#${activityLogTool} ${explainActivityLogPrompt}`
    }
}
