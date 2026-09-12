/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import type { z } from "zod";
import { startDeploymentCommand } from "../../../commands/copilotOnRails/registerCopilotOnRailsCommands";
import { azureDeployAgent } from "../../../constants";
import { callWithDiagnosticsAndTelemetryHandling } from "../../../utils/copilotOnRails/telemetryUtils";

const startDeploymentToolName = 'start_deployment';

export const startDeploymentTool: CopilotTool<z.ZodVoid, typeof UnspecifiedOutputSchema> = {
    name: startDeploymentToolName,
    description: `Hand off to the "${azureDeployAgent}" agent to onboard and deploy the project through the complete Azure App Onboard pipeline.`,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (_, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${startDeploymentToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: startDeploymentToolName, extras }, async (corContext) => {
                await startDeploymentCommand(corContext);
                return { message: 'Started the deployment agent.' };
            });
        }) ?? {
            message: 'Failed to start the deployment agent.',
        };
    }
};
