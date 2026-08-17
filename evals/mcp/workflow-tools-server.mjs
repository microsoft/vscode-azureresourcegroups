#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Stdio MCP server exposing the Copilot-on-Rails workflow gate tools.
 *
 * Used by the vally evals so graders can assert the agent called the right
 * gate tool (e.g. `workflow-tools-open_requirements_view`) at the right time.
 * Each tool is a no-op that acknowledges the call — the eval only cares that
 * the agent reached the gate, not what the gate renders.
 *
 * Usage: node evals/mcp/workflow-tools-server.mjs
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MCP_SERVER_NAME, TOOLS } from "./workflow-tools.mjs";

const server = new McpServer(
    { name: MCP_SERVER_NAME, version: "1.0.0" },
    { capabilities: { tools: {} } },
);

for (const [name, description] of TOOLS) {
    server.registerTool(
        name,
        { description, inputSchema: {} },
        async () => {
            // stdout is the MCP transport — diagnostics must go to stderr.
            process.stderr.write(`[workflow-tools] ${name}()\n`);
            return { content: [{ type: "text", text: `OK: ${name} executed successfully.` }] };
        },
    );
}

await server.connect(new StdioServerTransport());
process.stderr.write(`[workflow-tools] stdio MCP server ready (${TOOLS.length} tools)\n`);
