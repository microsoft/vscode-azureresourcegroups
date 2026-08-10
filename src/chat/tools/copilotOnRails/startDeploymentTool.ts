/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import { z } from "zod/mini";
import { startDeploymentCommand } from "../../../commands/copilotOnRails/registerCopilotOnRailsCommands";
import { azureDeployAgent } from "../../../constants";
import { callWithDiagnosticsAndTelemetryHandling } from "../../../utils/copilotOnRails/telemetryUtils";

const startDeploymentToolName = 'start_deployment';

const startDeploymentInputSchema = z.object({
    prompt: z.optional(z.string()),
});

export const startDeploymentTool: CopilotTool<typeof startDeploymentInputSchema, typeof UnspecifiedOutputSchema> = {
    name: startDeploymentToolName,
    description: `Hand off to the "${azureDeployAgent}" agent to onboard and deploy the project through the complete Azure App Onboard pipeline.`,
    inputSchema: startDeploymentInputSchema,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (input, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${startDeploymentToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: startDeploymentToolName, extras }, async (corContext) => {
                await startDeploymentCommand(corContext, input.prompt);
                return { message: 'Started the deployment agent.' };
            });
        }) ?? {
            message: 'Failed to start the deployment agent.',
        };
    }
};
