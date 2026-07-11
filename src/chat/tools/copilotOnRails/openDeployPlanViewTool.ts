/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import * as vscode from "vscode";
import { l10n } from "vscode";
import type { z } from "zod";
import { setCopilotOnRailsTelemetry } from "./setCopilotOnRailsTelemetry";
import { openDeployPlanViewCommand } from "../../../commands/copilotOnRails/registerCopilotOnRailsCommands";

const openDeployPlanViewToolName = 'open_deploy_plan_view';

export const openDeployPlanViewTool: CopilotTool<z.ZodVoid, typeof UnspecifiedOutputSchema> = {
    name: openDeployPlanViewToolName,
    description: 'Open the Deployment Plan webview that renders `.azure/deployment-plan.md` for user approval.',
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (_, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${openDeployPlanViewToolName}/execute`, async (context: IActionContext) => {
            setCopilotOnRailsTelemetry(context, extras);

            await vscode.commands.executeCommand(openDeployPlanViewCommand);

            return { message: l10n.t('Opened the Deployment Plan view.') };
        }) ?? {
            message: l10n.t('Failed to open the Deployment Plan view.'),
        };
    }
};
