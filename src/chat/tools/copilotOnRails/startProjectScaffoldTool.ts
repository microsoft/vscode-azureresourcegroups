/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import type { z } from "zod";
import { startProjectScaffoldCommand } from "../../../commands/copilotOnRails/registerCopilotOnRailsCommands";
import { azureProjectScaffoldAgent } from "../../../constants";
import { callWithDiagnosticsAndTelemetryHandling } from "../../../utils/copilotOnRails/telemetryUtils";

const startProjectScaffoldToolName = 'start_project_scaffold';

export const startProjectScaffoldTool: CopilotTool<z.ZodVoid, typeof UnspecifiedOutputSchema> = {
    name: startProjectScaffoldToolName,
    description: `Hand off to the "${azureProjectScaffoldAgent}" agent to scaffold the frontend, backend, database, and API routes.`,
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (_, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${startProjectScaffoldToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: startProjectScaffoldToolName, extras }, async (corContext) => {
                await startProjectScaffoldCommand(corContext);
                return { message: 'Started the project scaffold agent.' };
            });
        }) ?? {
            message: 'Failed to start the project scaffold agent.',
        };
    }
};
