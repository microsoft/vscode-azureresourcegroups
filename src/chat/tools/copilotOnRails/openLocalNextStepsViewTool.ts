/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import { z } from "zod/mini";
import { callWithDiagnosticsAndTelemetryHandling } from "../../../utils/copilotOnRails/copilotOnRailsTelemetryUtils";
import { openLocalDevNextStepsView } from "../../../webviews/copilotOnRails/extension/openLocalDevNextStepsView";

const openLocalNextStepsViewToolName = 'open_local_next_steps_view';

const openLocalNextStepsViewInputSchema = z.object({
    hasApiTests: z.optional(z.boolean()),
});

export const openLocalNextStepsViewTool: CopilotTool<typeof openLocalNextStepsViewInputSchema, typeof UnspecifiedOutputSchema> = {
    name: openLocalNextStepsViewToolName,
    description: 'Open the local development "Next Steps" webview.',
    inputSchema: openLocalNextStepsViewInputSchema,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (input, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${openLocalNextStepsViewToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: openLocalNextStepsViewToolName, extras }, async (corContext) => {
                await openLocalDevNextStepsView(corContext, input.hasApiTests);
                return { message: 'Opened the local development Next Steps view.' };
            });
        }) ?? {
            message: 'Failed to open the local development Next Steps view.',
        };
    }
};
