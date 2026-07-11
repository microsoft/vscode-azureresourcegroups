/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import * as vscode from "vscode";
import { l10n } from "vscode";
import { setCopilotToolTelemetry } from "./setCopilotToolTelemetry";
import { z } from "zod/mini";

const startDeploymentToolName = 'start_deployment';
const startDeploymentCommandId = 'azureResourceGroups.startDeployment';

const startDeploymentInputSchema = z.object({
    prompt: z.optional(z.string()),
});

export const startDeploymentTool: CopilotTool<typeof startDeploymentInputSchema, typeof UnspecifiedOutputSchema> = {
    name: startDeploymentToolName,
    description: 'Hand off to the `azure-deploy` agent in a new chat session to prepare the project for deployment to Azure (`.azure/deployment-plan.md`, infrastructure, `azure.yaml`, Dockerfiles). Accepts an optional prompt override.',
    inputSchema: startDeploymentInputSchema,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (input, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${startDeploymentToolName}/execute`, async (context: IActionContext) => {
            setCopilotToolTelemetry(context, extras);

            await vscode.commands.executeCommand(startDeploymentCommandId, input.prompt);

            return { message: l10n.t('Started the deployment agent.') };
        }) ?? {
            message: l10n.t('Failed to start the deployment agent.'),
        };
    }
};
