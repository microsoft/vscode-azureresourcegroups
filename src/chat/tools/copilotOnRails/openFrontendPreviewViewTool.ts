/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import { z } from "zod/mini";
import { callWithDiagnosticsAndTelemetryHandling } from "../../../utils/copilotOnRails/telemetryUtils";
import { openFrontendPreviewView } from "../../../webviews/copilotOnRails/extension/openFrontendPreviewView";

const openFrontendPreviewViewToolName = 'open_frontend_preview_view';

const openFrontendPreviewViewInputSchema = z.object({
    frontendFolder: z.optional(z.string()),
});

export const openFrontendPreviewViewTool: CopilotTool<typeof openFrontendPreviewViewInputSchema, typeof UnspecifiedOutputSchema> = {
    name: openFrontendPreviewViewToolName,
    description: 'Open the Frontend Preview webview to review and approve the running frontend app.',
    inputSchema: openFrontendPreviewViewInputSchema,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (input, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${openFrontendPreviewViewToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: openFrontendPreviewViewToolName, extras }, async (corContext) => {
                await openFrontendPreviewView(corContext, input.frontendFolder);
                return { message: 'Opened the Frontend Preview view.' };
            });
        }) ?? {
            message: 'Failed to open the Frontend Preview view.',
        };
    }
};
