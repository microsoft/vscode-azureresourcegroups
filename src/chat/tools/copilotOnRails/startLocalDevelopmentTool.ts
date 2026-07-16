/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import { l10n } from "vscode";
import { z } from "zod/mini";
import { callWithDiagnosticsAndTelemetryHandling } from "../../../utils/copilotOnRails/copilotOnRailsTelemetryUtils";
import { startLocalDevelopmentCommand } from "../../../commands/copilotOnRails/registerCopilotOnRailsCommands";

const startLocalDevelopmentToolName = 'start_local_development';

const startLocalDevelopmentInputSchema = z.object({
    prompt: z.optional(z.string()),
});

export const startLocalDevelopmentTool: CopilotTool<typeof startLocalDevelopmentInputSchema, typeof UnspecifiedOutputSchema> = {
    name: startLocalDevelopmentToolName,
    description: 'Hand off to the `azure-debug-plan` agent to set up the local debugging environment.',
    inputSchema: startLocalDevelopmentInputSchema,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (input, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${startLocalDevelopmentToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: startLocalDevelopmentToolName, extras }, async (corContext) => {
                await startLocalDevelopmentCommand(corContext, input.prompt);
                return { message: l10n.t('Started the local development agent.') };
            });
        }) ?? {
            message: l10n.t('Failed to start the local development agent.'),
        };
    }
};
