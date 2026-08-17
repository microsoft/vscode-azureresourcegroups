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
