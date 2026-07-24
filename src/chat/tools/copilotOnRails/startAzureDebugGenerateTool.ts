/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import { z } from "zod/mini";
import { startAzureDebugGenerateCommand } from "../../../commands/copilotOnRails/registerCopilotOnRailsCommands";
import { azureDebugGenerateAgent, azureDebugPlanAgent } from "../../../constants";
import { callWithDiagnosticsAndTelemetryHandling } from "../../../utils/copilotOnRails/telemetryUtils";

const startAzureDebugGenerateToolName = 'start_azure_debug_generate';

const startAzureDebugGenerateInputSchema = z.object({
    prompt: z.optional(z.string()),
});

export const startAzureDebugGenerateTool: CopilotTool<typeof startAzureDebugGenerateInputSchema, typeof UnspecifiedOutputSchema> = {
    name: startAzureDebugGenerateToolName,
    description: `Hand off to the "${azureDebugGenerateAgent}" agent to generate the artifacts specified by the "${azureDebugPlanAgent}" agent.`,
    inputSchema: startAzureDebugGenerateInputSchema,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (input, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${startAzureDebugGenerateToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: startAzureDebugGenerateToolName, extras }, async (corContext) => {
                await startAzureDebugGenerateCommand(corContext, input.prompt);
                return { message: 'Started the local development generate agent.' };
            });
        }) ?? {
            message: 'Failed to start the local development generate agent.',
        };
    }
};
