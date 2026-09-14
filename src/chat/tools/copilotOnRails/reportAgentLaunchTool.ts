/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from '@microsoft/vscode-azext-utils';
import { CopilotTool } from '@microsoft/vscode-inproc-mcp';
import { UnspecifiedOutputSchema } from '@microsoft/vscode-inproc-mcp/mcp';
import { z } from 'zod/mini';
import {
    azureDebugGenerateAgent,
    azureDebugPlanAgent,
    azureDeployAgent,
    azureProjectIntegrateAgent,
    azureProjectPlanAgent,
    azureProjectScaffoldAgent,
} from '../../../constants';
import { agentLaunchProtocolVersion, recordAgentLaunchAcknowledgement } from '../../../utils/copilotOnRails/agentLaunchDiagnostics';
import { callWithDiagnosticsAndTelemetryHandling, setCorProp } from '../../../utils/copilotOnRails/telemetryUtils';

export const reportAgentLaunchToolName = 'report_agent_launch';

const reportAgentLaunchInputSchema = z.object({
    agentName: z.enum([
        azureProjectPlanAgent,
        azureProjectScaffoldAgent,
        azureProjectIntegrateAgent,
        azureDebugPlanAgent,
        azureDebugGenerateAgent,
        azureDeployAgent,
    ]),
    protocolVersion: z.literal(agentLaunchProtocolVersion),
    reportedHarness: z.enum(['local', 'copilot', 'unknown']),
    toolDiscovery: z.enum(['direct', 'toolSearch', 'activated', 'unknown']),
    reportedModel: z.optional(z.string()),
});

export const reportAgentLaunchTool: CopilotTool<typeof reportAgentLaunchInputSchema, typeof UnspecifiedOutputSchema> = {
    name: reportAgentLaunchToolName,
    description: 'Record which Copilot on Rails custom agent and chat environment received the current launch request. CoR agents must call this before doing any project work.',
    inputSchema: reportAgentLaunchInputSchema,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (input, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${reportAgentLaunchToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: reportAgentLaunchToolName, extras }, async (corContext) => {
                setCorProp(corContext, 'reportedAgentName', input.agentName);
                setCorProp(corContext, 'reportedAgentLaunchProtocolVersion', input.protocolVersion);
                setCorProp(corContext, 'reportedHarness', input.reportedHarness);
                setCorProp(corContext, 'startupToolDiscovery', input.toolDiscovery);

                const launch = await recordAgentLaunchAcknowledgement(input);
                if (!launch) {
                    setCorProp(corContext, 'agentLaunchAcknowledgementOutcome', 'noPendingLaunch');
                    return {
                        message: 'Recorded the agent startup report, but no pending Copilot on Rails launch was found.',
                    };
                }

                setCorProp(corContext, 'agentLaunchAcknowledgementOutcome', 'recorded');
                setCorProp(corContext, 'expectedAgentName', launch.expectedAgent);
                setCorProp(corContext, 'agentNameMatched', launch.agentMatched);
                return {
                    message: launch.agentMatched
                        ? `Recorded startup for the expected "${launch.expectedAgent}" agent.`
                        : `Recorded startup for "${input.agentName}", but the extension expected "${launch.expectedAgent}". Stop without doing project work and tell the user to restart this Copilot on Rails stage.`,
                };
            });
        }) ?? {
            message: 'Failed to record the Copilot on Rails agent startup report.',
        };
    },
};
