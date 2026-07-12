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
import { copilotOnRailsCommandIds } from "../../../commands/copilotOnRails/registerCopilotOnRailsCommands";

const openScaffoldNextStepsViewToolName = 'open_scaffold_next_steps_view';

export const openScaffoldNextStepsViewTool: CopilotTool<z.ZodVoid, typeof UnspecifiedOutputSchema> = {
    name: openScaffoldNextStepsViewToolName,
    description: 'Open the post-integration "What\'s next?" webview, which drives the next hand-off (local development or deploy).',
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (_, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${openScaffoldNextStepsViewToolName}/execute`, async (context: IActionContext) => {
            setCopilotOnRailsTelemetry(context, extras);

            await vscode.commands.executeCommand(copilotOnRailsCommandIds.openScaffoldNextStepsView);

            return { message: l10n.t('Opened the Next Steps view.') };
        }) ?? {
            message: l10n.t('Failed to open the Next Steps view.'),
        };
    }
};
