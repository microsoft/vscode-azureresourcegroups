/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "node_modules/@microsoft/vscode-azext-utils";
import * as vscode from "vscode";

const agentName = "azure";

/**
 * A stand-in implementation of the Ask Azure command that should be invoked when the GitHub Copilot for Azure extension is not installed.
 * This implementation should inform the standIn chat provider to guide the user to reuse the Ask Azure action after installing the GitHub Copilot for Azure extension.
 */
export async function askAgentAboutResource(_actionContext: IActionContext, node?: { id?: string, value?: { armId: string }, resource?: { kind?: string } }) {
    const resourceId = node?.id ?? node?.value?.armId;
    if (resourceId !== undefined) {
        const prompt = `@${agentName} /setResourceContext I would like to talk to a selected resource.`;

        // GitHub Copilot for Azure needs to set the resourceConnect object to its in-memory cache but we cannot do it here because that extension is not installed.
        // So we submit a prompt indicating the intention of the Ask Azure action and guide the user on the next steps.
        await vscode.commands.executeCommand("workbench.action.chat.newChat");
        await vscode.commands.executeCommand("workbench.action.chat.open", { query: prompt });
    }
}
