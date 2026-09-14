/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from '@microsoft/vscode-azext-utils';
import { CopilotTool } from '@microsoft/vscode-inproc-mcp';
import { UnspecifiedOutputSchema } from '@microsoft/vscode-inproc-mcp/mcp';
import { z } from 'zod/mini';
import { callWithDiagnosticsAndTelemetryHandling, setCorProp } from '../../../utils/copilotOnRails/telemetryUtils';

export const reportAgentLaunchToolName = 'report_agent_launch';

const reportAgentLaunchInputSchema = z.object({
    agentName: z.string(),
});

export const reportAgentLaunchTool: CopilotTool<typeof reportAgentLaunchInputSchema, typeof UnspecifiedOutputSchema> = {
    name: reportAgentLaunchToolName,
    description: 'Record which Copilot on Rails custom agent received the current launch request.',
    inputSchema: reportAgentLaunchInputSchema,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (input, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${reportAgentLaunchToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: reportAgentLaunchToolName, extras }, async (corContext) => {
                setCorProp(corContext, 'agentName', input.agentName);
                return {
                    message: 'Recorded the Copilot on Rails agent startup.',
                };
            });
        }) ?? {
            message: 'Failed to record the Copilot on Rails agent startup report.',
        };
    },
};
