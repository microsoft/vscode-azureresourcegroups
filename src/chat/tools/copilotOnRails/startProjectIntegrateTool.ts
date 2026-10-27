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
import { azureProjectIntegrateAgent } from "../../../constants";
import { callWithDiagnosticsAndTelemetryHandling } from "../../../utils/copilotOnRails/telemetryUtils";

const startProjectIntegrateToolName = 'start_project_integrate';

export const startProjectIntegrateTool: CopilotTool<z.ZodVoid, typeof UnspecifiedOutputSchema> = {
    name: startProjectIntegrateToolName,
    description: `Hand off to the "${azureProjectIntegrateAgent}" agent to wire the frontend to live data, create migrations, and smoke-test the backend.`,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (_, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${startProjectIntegrateToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: startProjectIntegrateToolName, extras }, async () => {
                await vscode.commands.executeCommand(copilotOnRailsCommandIds.startProjectIntegrate);
                return { message: 'Started the project integrate agent.' };
            });
        }) ?? {
            message: 'Failed to start the project integrate agent.',
        };
    }
};
