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

const startLocalDevelopmentToolName = 'start_local_development';

const startLocalDevelopmentInputSchema = z.object({
    prompt: z.optional(z.string()),
});

export const startLocalDevelopmentTool: CopilotTool<typeof startLocalDevelopmentInputSchema, typeof UnspecifiedOutputSchema> = {
    name: startLocalDevelopmentToolName,
    description: 'Hand off to the `azure-debug-plan` agent in a new chat session to set up the local debugging environment. Accepts an optional prompt override.',
    inputSchema: startLocalDevelopmentInputSchema,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (input, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${startLocalDevelopmentToolName}/execute`, async (context: IActionContext) => {
            setCopilotOnRailsToolTelemetry(context, extras);

            await vscode.commands.executeCommand(copilotOnRailsCommandIds.startLocalDevelopment, input.prompt);

            return { message: l10n.t('Started the local development agent.') };
        }) ?? {
            message: l10n.t('Failed to start the local development agent.'),
        };
    }
};
