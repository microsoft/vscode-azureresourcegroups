/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import * as vscode from "vscode";
import { l10n } from "vscode";
import { z } from "zod/mini";
import { setCopilotOnRailsToolTelemetry } from "../../../commands/copilotOnRails/copilotOnRailsTelemetryUtils";
import { copilotOnRailsCommandIds } from "../../../commands/copilotOnRails/registerCopilotOnRailsCommands";

const startAzureDebugGenerateToolName = 'start_azure_debug_generate';

const startAzureDebugGenerateInputSchema = z.object({
    prompt: z.optional(z.string()),
});

export const startAzureDebugGenerateTool: CopilotTool<typeof startAzureDebugGenerateInputSchema, typeof UnspecifiedOutputSchema> = {
    name: startAzureDebugGenerateToolName,
    description: 'Hand off to the `azure-debug-generate` agent in a new chat session to generate the artifacts specified by `.azure/vscode-debug-plan.md`. Accepts an optional prompt override.',
    inputSchema: startAzureDebugGenerateInputSchema,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (input, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${startAzureDebugGenerateToolName}/execute`, async (context: IActionContext) => {
            setCopilotOnRailsToolTelemetry(context, extras);

            await vscode.commands.executeCommand(copilotOnRailsCommandIds.startAzureDebugGenerate, input.prompt);

            return { message: l10n.t('Started the local development generate agent.') };
        }) ?? {
            message: l10n.t('Failed to start the local development generate agent.'),
        };
    }
};
