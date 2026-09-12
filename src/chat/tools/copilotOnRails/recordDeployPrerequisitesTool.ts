/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import { z } from "zod/mini";
import { callWithDiagnosticsAndTelemetryHandling } from "../../../utils/copilotOnRails/telemetryUtils";
import { recordDeployPrerequisites } from "../../../webviews/copilotOnRails/extension/openDeploymentPlanView";
import { normalizeDeployPrerequisites } from "../../../webviews/copilotOnRails/extension/utils/deployPrerequisites";

const recordDeployPrerequisitesToolName = 'record_deploy_prerequisites';

const recordDeployPrerequisitesInputSchema = z.object({
    tools: z.array(z.object({
        id: z.enum(['azd', 'az']),
        installed: z.boolean(),
        version: z.optional(z.string()),
    })),
});

const failedMessage: string = 'Failed to record deployment prerequisites.';

export const recordDeployPrerequisitesTool: CopilotTool<typeof recordDeployPrerequisitesInputSchema, typeof UnspecifiedOutputSchema> = {
    name: recordDeployPrerequisitesToolName,
    description: 'Record the install status of the deployment prerequisites (Azure Developer CLI "azd" and Azure CLI "az") to surface when the deploy plan view appears for approval.',
    inputSchema: recordDeployPrerequisitesInputSchema,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (input, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${recordDeployPrerequisitesToolName}/execute`, async (context: IActionContext) => {
            context.telemetry.properties.tools = JSON.stringify(input.tools);

            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: recordDeployPrerequisitesToolName, extras }, async () => {
                const prerequisites = normalizeDeployPrerequisites(input.tools);
                const recorded = await recordDeployPrerequisites(prerequisites);
                return {
                    message: recorded
                        ? 'Recorded deployment prerequisites. They will appear in the Deployment Plan view.'
                        : failedMessage,
                };
            });
        }) ?? {
            message: failedMessage,
        };
    }
};
