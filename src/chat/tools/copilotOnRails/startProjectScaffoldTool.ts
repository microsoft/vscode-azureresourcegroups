/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import { z } from "zod/mini";
import { callWithDiagnosticsAndTelemetryHandling } from "../../../utils/copilotOnRails/copilotOnRailsTelemetryUtils";
import { startProjectScaffoldCommand } from "../../../commands/copilotOnRails/registerCopilotOnRailsCommands";
import { azureProjectScaffoldAgent } from "../../../constants";

const startProjectScaffoldToolName = 'start_project_scaffold';

const startProjectScaffoldInputSchema = z.object({
    prompt: z.optional(z.string()),
});

export const startProjectScaffoldTool: CopilotTool<typeof startProjectScaffoldInputSchema, typeof UnspecifiedOutputSchema> = {
    name: startProjectScaffoldToolName,
    description: `Hand off to the "${azureProjectScaffoldAgent}" agent to scaffold the frontend, backend, database, and API routes.`,
    inputSchema: startProjectScaffoldInputSchema,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (input, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${startProjectScaffoldToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: startProjectScaffoldToolName, extras }, async (corContext) => {
                await startProjectScaffoldCommand(corContext, input.prompt);
                return { message: 'Started the project scaffold agent.' };
            });
        }) ?? {
            message: 'Failed to start the project scaffold agent.',
        };
    }
};
