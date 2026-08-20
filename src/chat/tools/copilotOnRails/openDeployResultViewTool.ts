/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import type { z } from "zod";
import { azureDeployAgent } from "../../../constants";
import { DEPLOY_RESULT_FILE_GLOBS } from "../../../tree/project/projectPlanFiles";
import { callWithDiagnosticsAndTelemetryHandling } from "../../../utils/copilotOnRails/telemetryUtils";
import { openDeployResultViewFromWorkspace } from "../../../webviews/copilotOnRails/extension/openDeployResultView";

const openDeployResultViewToolName = 'open_deploy_result_view';

export const openDeployResultViewTool: CopilotTool<z.ZodVoid, typeof UnspecifiedOutputSchema> = {
    name: openDeployResultViewToolName,
    description: 'Open the Deployment Results webview, which summarizes a finished deployment: status, endpoints, health, provisioned resources, and cleanup commands. Call this once `deploy-result.json` has been finalized at the end of the deploy phase.',
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (_, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${openDeployResultViewToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: openDeployResultViewToolName, extras }, async (corContext) => {
                await openDeployResultViewFromWorkspace(corContext);
                return { message: 'Opened the Deployment Results view.' };
            });
        }) ?? {
            message: `Failed to open the Deployment Results view. Ensure one of "${DEPLOY_RESULT_FILE_GLOBS.join('" or "')}" exists in the current workspace. It is written by the "${azureDeployAgent}" agent at the end of the deploy phase.`,
        };
    }
};
