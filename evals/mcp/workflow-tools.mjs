/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The workflow gate tools shared by the mock MCP server and the skill generator.
 *
 * Kept separate from `workflow-tools-server.mjs` so importing the list does not
 * start a stdio server.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const MCP_SERVER_NAME = "workflow-tools";

/** Gate tools the production agents call; exposed to the agent as `workflow-tools-<name>`. */
export const TOOLS = [
    ["open_requirements_view", "Open the requirements webview so the user can review and submit the gathered requirements."],
    ["open_plan_view", "Open the project plan webview so the user can review and approve the generated plan."],
    ["open_frontend_preview_view", "Open the frontend preview webview."],
    ["open_deploy_plan_view", "Open the deployment plan webview."],
    ["open_local_plan_view", "Open the local development plan webview."],
    ["open_local_next_steps_view", "Open the local development next steps webview."],
    ["open_scaffold_next_steps_view", "Open the scaffold next steps webview."],
    ["start_project_scaffold", "Hand off to the scaffolding agent to generate the project."],
    ["start_project_integrate", "Hand off to the integration agent."],
    ["start_azure_debug_generate", "Hand off to the VS Code debug configuration generator."],
    ["start_local_development", "Hand off to the local development setup agent."],
    ["start_deployment", "Hand off to the deployment agent."],
];

/** Session config registering the mock server; shared so the executor and the preflight agree. */
export function mcpServerConfig() {
    return {
        [MCP_SERVER_NAME]: {
            type: "local",
            command: "node",
            args: [path.resolve(path.dirname(fileURLToPath(import.meta.url)), "workflow-tools-server.mjs")],
            tools: ["*"],
        },
    };
}

/**
 * Block until the mock server finishes connecting.
 *
 * `createSession` resolves before MCP servers finish registering, so a prompt sent
 * immediately after can start a turn whose tool list has no gate tools in it. That
 * loses a race we happened to win on warm dev machines and lose on cold CI runners,
 * where it looked like the agent ignoring the gates rather than never being offered
 * them. Returns the last host listing so callers can report why a wait failed.
 */
export async function waitForMcpServer(session, { timeoutMs = 30_000, intervalMs = 250 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let listing;
    for (;;) {
        listing = await session.rpc.mcp.list().catch(() => undefined);
        const server = (listing?.servers ?? []).find(s => s.name === MCP_SERVER_NAME);
        if (server?.status === "connected") {return { ok: true, listing };}
        // A server that failed to start will never become connected — stop early.
        if (server?.status === "failed") {return { ok: false, listing, reason: "failed" };}
        if (Date.now() >= deadline) {
            return { ok: false, listing, reason: server ? `stuck in '${server.status}'` : "never registered" };
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
}
