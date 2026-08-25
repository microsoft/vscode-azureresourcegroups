/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The workflow gate tools shared by the mock MCP server and the skill generator.
 *
 * The tools are registered in-process on the eval session (see `workflowToolDefinitions`)
 * rather than served over MCP, so they are not subject to the MCP registry policy.
 */

import { defineTool } from "@github/copilot-sdk";

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


/**
 * The gate tools as in-process SDK tools, named exactly as the agent calls them.
 *
 * Registering these directly on the session instead of over MCP keeps the evals
 * independent of the MCP registry policy. That policy is fetched from the API with
 * the caller's token, and a token that cannot read it (the Actions `GITHUB_TOKEN`
 * gets 403) makes the runtime block every non-default MCP server — the server is
 * filtered before it starts, so it surfaces as an empty server list rather than an
 * error, and every gate-tool grader fails for reasons unrelated to the agent.
 *
 * `defer: "never"` keeps them out of lazy tool search so the agent always sees them,
 * and `skipPermission` stops a permission prompt from stalling an unattended run.
 */
export function workflowToolDefinitions() {
    return TOOLS.map(([name, description]) => defineTool(`${MCP_SERVER_NAME}-${name}`, {
        description,
        parameters: { type: "object", properties: {}, additionalProperties: true },
        skipPermission: true,
        defer: "never",
        handler: async () => ({
            content: [{ type: "text", text: `OK: ${name} executed successfully.` }],
        }),
    }));
}
