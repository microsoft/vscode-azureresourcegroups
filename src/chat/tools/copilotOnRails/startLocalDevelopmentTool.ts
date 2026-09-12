/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import * as vscode from "vscode";
import type { z } from "zod";
import { copilotOnRailsCommandIds } from "../../../commands/copilotOnRails/registerCopilotOnRailsCommands";
import { azureDebugPlanAgent } from "../../../constants";
import { callWithDiagnosticsAndTelemetryHandling } from "../../../utils/copilotOnRails/telemetryUtils";

const startLocalDevelopmentToolName = 'start_local_development';

export const startLocalDevelopmentTool: CopilotTool<z.ZodVoid, typeof UnspecifiedOutputSchema> = {
    name: startLocalDevelopmentToolName,
    description: `Hand off to the "${azureDebugPlanAgent}" agent to set up the local debugging environment.`,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (_, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${startLocalDevelopmentToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: startLocalDevelopmentToolName, extras }, async () => {
                await vscode.commands.executeCommand(copilotOnRailsCommandIds.startLocalDevelopment);
                return { message: 'Started the local development agent.' };
            });
        }) ?? {
            message: 'Failed to start the local development agent.',
        };
    }
};
