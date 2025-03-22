/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";

// Todo: Add telemetry properties for the entrypoint so we can determine which users prefer

const genericActivityLogPrompt = vscode.l10n.t(`I'd like to ask you questions about my VS Code activity log.`);

export async function askAgentAboutActivityLog(_context: IActionContext, node?: AzExtTreeItem) {
    await vscode.commands.executeCommand("workbench.action.chat.newChat");

    if (!node) {
        await vscode.commands.executeCommand("workbench.action.chat.open", { query: `#azureActivityLog ${genericActivityLogPrompt}` });
    } else {
        await vscode.commands.executeCommand("workbench.action.chat.open", { query: `#azureActivityLog ${genericActivityLogPrompt} I'm interested in the activity item with treeId: ${node.id}.` });
    }
}
