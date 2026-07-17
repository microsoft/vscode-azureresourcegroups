/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import type { z } from "zod";
import { azureDebugPlanAgent } from "../../../constants";
import { DEBUG_PLAN_FILE_GLOB } from "../../../tree/project/projectPlanFiles";
import { callWithDiagnosticsAndTelemetryHandling } from "../../../utils/copilotOnRails/copilotOnRailsTelemetryUtils";
import { openLocalPlanViewFromWorkspace } from "../../../webviews/copilotOnRails/extension/openLocalPlanView";

const openLocalPlanViewToolName = 'open_local_plan_view';

export const openLocalPlanViewTool: CopilotTool<z.ZodVoid, typeof UnspecifiedOutputSchema> = {
    name: openLocalPlanViewToolName,
    description: 'Open the Local Development Plan webview for user approval.',
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (_, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${openLocalPlanViewToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: openLocalPlanViewToolName, extras }, async (corContext) => {
                await openLocalPlanViewFromWorkspace(corContext);
                return { message: 'Opened the Local Development Plan view.' };
            });
        }) ?? {
            message: `Failed to open the Local Development Plan view. Ensure "${DEBUG_PLAN_FILE_GLOB}" exists in the current workspace. You can generate it using the "${azureDebugPlanAgent}" agent.`,
        };
    }
};
