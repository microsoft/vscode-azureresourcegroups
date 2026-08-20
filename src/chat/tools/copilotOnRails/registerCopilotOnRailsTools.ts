/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerMcpToolWithTelemetry } from "@microsoft/vscode-inproc-mcp/vscode";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { captureDeploymentInventoryTool } from "./captureDeploymentInventoryTool";
import { openDeployPlanViewTool } from "./openDeployPlanViewTool";
import { openDeployResultViewTool } from "./openDeployResultViewTool";
import { openFrontendPreviewViewTool } from "./openFrontendPreviewViewTool";
import { openLocalNextStepsViewTool } from "./openLocalNextStepsViewTool";
import { openLocalPlanViewTool } from "./openLocalPlanViewTool";
import { openPlanViewTool } from "./openPlanViewTool";
import { openRequirementsViewTool } from "./openRequirementsViewTool";
import { openScaffoldNextStepsViewTool } from "./openScaffoldNextStepsViewTool";
import { startAzureDebugGenerateTool } from "./startAzureDebugGenerateTool";
import { startDeploymentTool } from "./startDeploymentTool";
import { startLocalDevelopmentTool } from "./startLocalDevelopmentTool";
import { startProjectIntegrateTool } from "./startProjectIntegrateTool";
import { startProjectScaffoldTool } from "./startProjectScaffoldTool";

export function registerCopilotOnRailsTools(mcpServer: McpServer): void {
    // Phase 1: Project scaffolding tools
    registerMcpToolWithTelemetry(mcpServer, openRequirementsViewTool);
    registerMcpToolWithTelemetry(mcpServer, openPlanViewTool);
    registerMcpToolWithTelemetry(mcpServer, startProjectScaffoldTool);
    registerMcpToolWithTelemetry(mcpServer, openFrontendPreviewViewTool);
    registerMcpToolWithTelemetry(mcpServer, startProjectIntegrateTool);
    registerMcpToolWithTelemetry(mcpServer, openScaffoldNextStepsViewTool);

    // Phase 2: Local debug / development tools
    registerMcpToolWithTelemetry(mcpServer, startLocalDevelopmentTool);
    registerMcpToolWithTelemetry(mcpServer, openLocalPlanViewTool);
    registerMcpToolWithTelemetry(mcpServer, startAzureDebugGenerateTool);
    registerMcpToolWithTelemetry(mcpServer, openLocalNextStepsViewTool);

    // Phase 3: Deployment tools
    registerMcpToolWithTelemetry(mcpServer, startDeploymentTool);
    registerMcpToolWithTelemetry(mcpServer, openDeployPlanViewTool);
    registerMcpToolWithTelemetry(mcpServer, captureDeploymentInventoryTool);
    registerMcpToolWithTelemetry(mcpServer, openDeployResultViewTool);
}
