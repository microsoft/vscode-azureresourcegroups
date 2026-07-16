/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerMcpToolWithTelemetry } from "@microsoft/vscode-inproc-mcp/vscode";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAzureActivityLogTool } from "./azureActivityLog/getAzureActivityLog/getAzureActivityLogTool";
import { registerCopilotOnRailsTools } from "./copilotOnRails/registerCopilotOnRailsTools";

export function registerMcpTools(mcpServer: McpServer): void {
    // Activity Log Tools
    registerMcpToolWithTelemetry(mcpServer, getAzureActivityLogTool);

    // Copilot on Rails Tools
    registerCopilotOnRailsTools(mcpServer);
}
