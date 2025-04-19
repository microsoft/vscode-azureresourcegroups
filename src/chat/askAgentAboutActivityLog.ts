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
    await vscode.commands.executeCommand("workbench.action.chat.open", { mode: 'agent', query: generateActivityLogPrompt(ActivityLogPromptType.Explain) });
}

export async function askAgentAboutActivityLogItem(_: IActionContext, promptType: ActivityLogPromptType, node?: ActivityItem | ActivityChildItemBase): Promise<void> {
    if (!node?.id) {
        return await askAgentAboutActivityLog();
    }
    await vscode.commands.executeCommand("workbench.action.chat.newChat");
    await vscode.commands.executeCommand("workbench.action.chat.open", { mode: 'agent', query: generateActivityLogPrompt(promptType, node.id) });
}

const explainActivityLogPrompt: string = vscode.l10n.t('Help explain the important information in my VS Code activity log.');
const fixActivityLogPrompt: string = vscode.l10n.t('Help me diagnose and fix the error in my VS Code activity log.');

function generateActivityLogPrompt(promptType: ActivityLogPromptType, treeId?: string): string {
    switch (promptType) {
        case ActivityLogPromptType.Fix:
            return treeId ?
                `${fixActivityLogPrompt} ${vscode.l10n.t(`I'm interested in fixing the activity item with treeId: {0}.`, treeId)}` :
                `${fixActivityLogPrompt}`;
        case ActivityLogPromptType.Explain:
            return treeId ?
                `${explainActivityLogPrompt} ${vscode.l10n.t(`I'm interested in an explanation of activity item with treeId: {0}.`, treeId)}` :
                `${explainActivityLogPrompt}`
    }
}
