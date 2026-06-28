/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerMcpToolWithTelemetry } from "@microsoft/vscode-inproc-mcp/vscode";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAzureActivityLogTool } from "./azureActivityLog/getAzureActivityLog/GetAzureActivityLog";

export function registerAzExtTools(mcpServer: McpServer): void {
    registerMcpToolWithTelemetry(mcpServer, getAzureActivityLogTool);
}
