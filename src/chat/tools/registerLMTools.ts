/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtLMTool, registerLMTool } from '@microsoft/vscode-azext-utils';
import { getActiveWorkflowTags, recordToolCall } from '../../webviews/copilotOnRails/extension/telemetry/workflowTelemetry';
import { GetAzureActivityLog } from './GetAzureActivityLog/GetAzureActivityLog';

/**
 * Wraps an LM tool's `invoke` with latency + outcome telemetry, tagged with the
 * active workflow phase/agent. `registerLMTool` already creates the telemetry
 * event and records success/failure; here we only augment it with the call
 * duration and phase/agent tags, plus per-session counters. Only metrics and
 * enumerated tags are recorded — never tool arguments or results.
 */
function withToolTelemetry<T>(toolName: string, tool: AzExtLMTool<T>): AzExtLMTool<T> {
    return {
        prepareInvocation: tool.prepareInvocation?.bind(tool),
        invoke: async (context, options, token) => {
            const start = Date.now();
            const tags = getActiveWorkflowTags();
            context.telemetry.properties.lmToolName = toolName;
            if (tags.phase) { context.telemetry.properties.phase = tags.phase; }
            if (tags.agent) { context.telemetry.properties.agent = tags.agent; }
            if (tags.sessionId) { context.telemetry.properties.sessionId = tags.sessionId; }
            try {
                const result = await tool.invoke(context, options, token);
                const latencyMs = Date.now() - start;
                context.telemetry.measurements.toolLatencyMs = latencyMs;
                context.telemetry.properties.toolOutcome = 'success';
                void recordToolCall({ name: toolName, latencyMs, success: true });
                return result;
            } catch (err) {
                const latencyMs = Date.now() - start;
                context.telemetry.measurements.toolLatencyMs = latencyMs;
                context.telemetry.properties.toolOutcome = 'failure';
                void recordToolCall({ name: toolName, latencyMs, success: false });
                throw err;
            }
        },
    };
}

export function registerLMTools(): void {
    // Contextual tools
    registerLMTool('azureResources_getAzureActivityLog', withToolTelemetry('azureResources_getAzureActivityLog', new GetAzureActivityLog()));

    // Functional tools
}
