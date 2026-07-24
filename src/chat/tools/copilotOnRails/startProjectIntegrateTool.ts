/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import { z } from "zod/mini";
import { startProjectIntegrateCommand } from "../../../commands/copilotOnRails/registerCopilotOnRailsCommands";
import { azureProjectIntegrateAgent } from "../../../constants";
import { callWithDiagnosticsAndTelemetryHandling } from "../../../utils/copilotOnRails/telemetryUtils";

const startProjectIntegrateToolName = 'start_project_integrate';

const startProjectIntegrateInputSchema = z.object({
    prompt: z.optional(z.string()),
});

export const startProjectIntegrateTool: CopilotTool<typeof startProjectIntegrateInputSchema, typeof UnspecifiedOutputSchema> = {
    name: startProjectIntegrateToolName,
    description: `Hand off to the "${azureProjectIntegrateAgent}" agent to wire the frontend to live data, create migrations, and smoke-test the backend.`,
    inputSchema: startProjectIntegrateInputSchema,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (input, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${startProjectIntegrateToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: startProjectIntegrateToolName, extras }, async (corContext) => {
                await startProjectIntegrateCommand(corContext, input.prompt);
                return { message: 'Started the project integrate agent.' };
            });
        }) ?? {
            message: 'Failed to start the project integrate agent.',
        };
    }
};
