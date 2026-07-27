/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import type { z } from "zod";
import { azureDeployAgent } from "../../../constants";
import { DEPLOYMENT_PLAN_FILE_GLOB } from "../../../tree/project/projectPlanFiles";
import { callWithDiagnosticsAndTelemetryHandling } from "../../../utils/copilotOnRails/telemetryUtils";
import { openDeploymentPlanViewFromWorkspace } from "../../../webviews/copilotOnRails/extension/openDeploymentPlanView";

const openDeployPlanViewToolName = 'open_deploy_plan_view';

export const openDeployPlanViewTool: CopilotTool<z.ZodVoid, typeof UnspecifiedOutputSchema> = {
    name: openDeployPlanViewToolName,
    description: 'Open the Deployment Plan webview for user approval.',
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (_, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${openDeployPlanViewToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: openDeployPlanViewToolName, extras }, async (corContext) => {
                await openDeploymentPlanViewFromWorkspace(corContext);
                return { message: 'Opened the Deployment Plan view.' };
            });
        }) ?? {
            message: `Failed to open the Deployment Plan view. Ensure "${DEPLOYMENT_PLAN_FILE_GLOB}" exists in the current workspace. You can generate it using the "${azureDeployAgent}" agent.`,
        };
    }
};
