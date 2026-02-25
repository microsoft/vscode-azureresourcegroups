/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";

const mcpServerId = "ms-azuretools.vscode-azureresourcegroups/Azure Code Assistant";

export async function openAzureCodeAgent(_context: IActionContext): Promise<void> {
    // Open a new chat session with the Azure Code Assistant agent.
    await vscode.commands.executeCommand("workbench.action.chat.newChat");
    await vscode.commands.executeCommand("workbench.action.chat.open", {
        mode: "Azure Code Assistant"
    });

    // Start the MCP server
    await vscode.commands.executeCommand("workbench.mcp.startServer", mcpServerId, { waitForLiveTools: true });

    // Allow time for tools to propagate
    await new Promise(resolve => setTimeout(resolve, 2000));

    const mcpTools = vscode.lm.tools.filter(t =>
        t.name.includes("azure-code-assistant") ||
        t.name.includes("select_preferred_language") ||
        t.name.includes("report_language_selection") ||
        t.name.includes("ask_next_step") ||
        t.name.includes("report_next_step_choice")
    );

    if (mcpTools.length === 0) {
        vscode.window.showWarningMessage(`No tools found from the Azure Code Assistant MCP server.`);
    } else {
        vscode.window.showInformationMessage(`Azure Code Assistant is ready to use with the necessary tools registered.`);
    }
}
