/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import type { z } from "zod";
import { callWithDiagnosticsAndTelemetryHandling } from "../../../utils/copilotOnRails/copilotOnRailsTelemetryUtils";
import { openScaffoldNextStepsView } from "../../../webviews/copilotOnRails/extension/openScaffoldNextStepsView";

const openScaffoldNextStepsViewToolName = 'open_scaffold_next_steps_view';

export const openScaffoldNextStepsViewTool: CopilotTool<z.ZodVoid, typeof UnspecifiedOutputSchema> = {
    name: openScaffoldNextStepsViewToolName,
    description: 'Open the project scaffold "Next Steps" webview.',
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (_, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${openScaffoldNextStepsViewToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: openScaffoldNextStepsViewToolName, extras }, async (corContext) => {
                openScaffoldNextStepsView(corContext);
                return { message: 'Opened the Next Steps view.' };
            });
        }) ?? {
            message: 'Failed to open the Next Steps view.',
        };
    }
};
