/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import type { z } from "zod";
import { azureProjectPlanAgent } from "../../../constants";
import { PROJECT_PLAN_FILE_GLOB } from "../../../tree/project/projectPlanFiles";
import { callWithDiagnosticsAndTelemetryHandling } from "../../../utils/copilotOnRails/telemetryUtils";
import { openPlanViewFromWorkspace } from "../../../webviews/copilotOnRails/extension/openScaffoldPlanView";

const openPlanViewToolName = 'open_plan_view';

export const openPlanViewTool: CopilotTool<z.ZodVoid, typeof UnspecifiedOutputSchema> = {
    name: openPlanViewToolName,
    description: 'Open the Project Plan webview for user approval.',
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (_, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${openPlanViewToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: openPlanViewToolName, extras }, async (corContext) => {
                await openPlanViewFromWorkspace(corContext);
                return { message: 'Opened the Plan view.' };
            });
        }) ?? {
            message: `Failed to open the Plan view. Ensure "${PROJECT_PLAN_FILE_GLOB}" exists in the current workspace. You can generate it using the "${azureProjectPlanAgent}" agent.`,
        };
    }
};
