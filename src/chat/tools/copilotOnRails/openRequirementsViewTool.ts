/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import type { z } from "zod";
import { REQUIREMENTS_FILE_GLOB } from "../../../tree/project/projectPlanFiles";
import { callWithDiagnosticsAndTelemetryHandling } from "../../../utils/copilotOnRails/telemetryUtils";
import { openRequirementsViewFromWorkspace } from "../../../webviews/copilotOnRails/extension/openRequirementsView";

const openRequirementsViewToolName = 'open_requirements_view';

export const openRequirementsViewTool: CopilotTool<z.ZodVoid, typeof UnspecifiedOutputSchema> = {
    name: openRequirementsViewToolName,
    description: 'Open the Requirements webview to gather project requirements.',
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (_, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${openRequirementsViewToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: openRequirementsViewToolName, extras }, async (corContext) => {
                await openRequirementsViewFromWorkspace(corContext);
                return { message: 'Opened the Requirements view. Wait for user input before proceeding.' };
            });
        }) ?? {
            message: `Failed to open the Requirements view. Ensure "${REQUIREMENTS_FILE_GLOB}" exists in the current workspace.`,
        };
    }
};
