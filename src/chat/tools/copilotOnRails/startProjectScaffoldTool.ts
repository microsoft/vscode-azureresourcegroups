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

const startProjectScaffoldToolName = 'start_project_scaffold';
const startProjectScaffoldCommandId = 'azureResourceGroups.startProjectScaffold';

const startProjectScaffoldInputSchema = z.object({
    prompt: z.optional(z.string()),
});

export const startProjectScaffoldTool: CopilotTool<typeof startProjectScaffoldInputSchema, typeof UnspecifiedOutputSchema> = {
    name: startProjectScaffoldToolName,
    description: 'Hand off to the `azure-project-scaffold` agent in a new chat session to scaffold the frontend, backend, database, and API routes. Accepts an optional prompt override.',
    inputSchema: startProjectScaffoldInputSchema,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (input, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${startProjectScaffoldToolName}/execute`, async (context: IActionContext) => {
            setCopilotToolTelemetry(context, extras);

            await vscode.commands.executeCommand(startProjectScaffoldCommandId, input.prompt);

            return { message: l10n.t('Started the project scaffold agent.') };
        }) ?? {
            message: l10n.t('Failed to start the project scaffold agent.'),
        };
    }
};
