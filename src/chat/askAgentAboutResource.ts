/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";

const agentName = "azure";

export const askAgentAboutResourcePrompt = vscode.l10n.t(`I'd like to ask you about my resource.`);

/**
 * A stand-in implementation of the Ask Azure command that should be invoked when the GitHub Copilot for Azure extension is not installed.
 *
 * This implementation uses a simplified injected prompt compared to the real Ask Azure command implementation in the GitHub Copilot for Azure extension.
 */
export async function askAgentAboutResource(_actionContext: IActionContext, node?: { id?: string, value?: { armId: string }, resource?: { kind?: string } }) {
    const resourceId = node?.id ?? node?.value?.armId;
    if (resourceId !== undefined) {
        const prompt = `@${agentName} ${askAgentAboutResourcePrompt}`;

        await vscode.commands.executeCommand("workbench.action.chat.newChat");
        await vscode.commands.executeCommand("workbench.action.chat.open", { query: prompt });
    }
}
