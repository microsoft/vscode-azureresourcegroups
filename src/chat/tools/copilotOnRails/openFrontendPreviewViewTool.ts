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
import { setCopilotOnRailsTelemetry } from "./setCopilotOnRailsTelemetry";
import { copilotOnRailsCommandIds } from "../../../commands/copilotOnRails/registerCopilotOnRailsCommands";

const openFrontendPreviewViewToolName = 'open_frontend_preview_view';

const openFrontendPreviewViewInputSchema = z.object({
    frontendFolder: z.optional(z.string()),
});

export const openFrontendPreviewViewTool: CopilotTool<typeof openFrontendPreviewViewInputSchema, typeof UnspecifiedOutputSchema> = {
    name: openFrontendPreviewViewToolName,
    description: 'Open the Frontend Preview webview, which starts the frontend dev server (mock data) and renders the running app with an "Approve UI" gate. Its Approve button owns the hand-off to the integrate agent.',
    inputSchema: openFrontendPreviewViewInputSchema,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (input, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${openFrontendPreviewViewToolName}/execute`, async (context: IActionContext) => {
            setCopilotOnRailsTelemetry(context, extras);

            await vscode.commands.executeCommand(copilotOnRailsCommandIds.openFrontendPreviewView, input.frontendFolder);

            return { message: l10n.t('Opened the Frontend Preview view.') };
        }) ?? {
            message: l10n.t('Failed to open the Frontend Preview view.'),
        };
    }
};
