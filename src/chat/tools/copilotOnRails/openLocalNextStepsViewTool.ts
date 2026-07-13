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

const openLocalNextStepsViewToolName = 'open_local_next_steps_view';

const openLocalNextStepsViewInputSchema = z.object({
    hasApiTests: z.optional(z.boolean()),
});

export const openLocalNextStepsViewTool: CopilotTool<typeof openLocalNextStepsViewInputSchema, typeof UnspecifiedOutputSchema> = {
    name: openLocalNextStepsViewToolName,
    description: 'Open the local development "Next Steps" webview after the local debugging artifacts are generated.',
    inputSchema: openLocalNextStepsViewInputSchema,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (input, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${openLocalNextStepsViewToolName}/execute`, async (context: IActionContext) => {
            setCopilotOnRailsToolTelemetry(context, extras);

            await vscode.commands.executeCommand(copilotOnRailsCommandIds.openLocalNextStepsView, input.hasApiTests);

            return { message: l10n.t('Opened the local development Next Steps view.') };
        }) ?? {
            message: l10n.t('Failed to open the local development Next Steps view.'),
        };
    }
};
