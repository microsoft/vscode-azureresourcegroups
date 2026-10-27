/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import * as vscode from "vscode";
import type { z } from "zod";
import { copilotOnRailsCommandIds } from "../../../commands/copilotOnRails/registerCopilotOnRailsCommands";
import { azureDebugGenerateAgent, azureDebugPlanAgent } from "../../../constants";
import { callWithDiagnosticsAndTelemetryHandling } from "../../../utils/copilotOnRails/telemetryUtils";

const startAzureDebugGenerateToolName = 'start_azure_debug_generate';

export const startAzureDebugGenerateTool: CopilotTool<z.ZodVoid, typeof UnspecifiedOutputSchema> = {
    name: startAzureDebugGenerateToolName,
    description: `Hand off to the "${azureDebugGenerateAgent}" agent to generate the artifacts specified by the "${azureDebugPlanAgent}" agent.`,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (_, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${startAzureDebugGenerateToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: startAzureDebugGenerateToolName, extras }, async () => {
                await vscode.commands.executeCommand(copilotOnRailsCommandIds.startAzureDebugGenerate);
                return { message: 'Started the local development generate agent.' };
            });
        }) ?? {
            message: 'Failed to start the local development generate agent.',
        };
    }
};
