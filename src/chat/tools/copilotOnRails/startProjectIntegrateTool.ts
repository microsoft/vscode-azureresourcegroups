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

const startProjectIntegrateToolName = 'start_project_integrate';
const startProjectIntegrateCommandId = 'azureResourceGroups.startProjectIntegrate';

const startProjectIntegrateInputSchema = z.object({
    prompt: z.optional(z.string()),
});

export const startProjectIntegrateTool: CopilotTool<typeof startProjectIntegrateInputSchema, typeof UnspecifiedOutputSchema> = {
    name: startProjectIntegrateToolName,
    description: 'Hand off to the `azure-project-integrate` agent in a new chat session to wire the frontend to live data, create migrations, and smoke-test the backend. Accepts an optional prompt override.',
    inputSchema: startProjectIntegrateInputSchema,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (input, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${startProjectIntegrateToolName}/execute`, async (context: IActionContext) => {
            setCopilotToolTelemetry(context, extras);

            await vscode.commands.executeCommand(startProjectIntegrateCommandId, input.prompt);

            return { message: l10n.t('Started the project integrate agent.') };
        }) ?? {
            message: l10n.t('Failed to start the project integrate agent.'),
        };
    }
};
