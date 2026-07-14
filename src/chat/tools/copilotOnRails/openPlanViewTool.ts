/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import { l10n } from "vscode";
import type { z } from "zod";
import { callWithDiagnosticsAndTelemetryHandling } from "../../../utils/copilotOnRails/copilotOnRailsTelemetryUtils";
import { openPlanViewFromWorkspace } from "../../../webviews/copilotOnRails/extension/openScaffoldPlanView";

const openPlanViewToolName = 'open_plan_view';

export const openPlanViewTool: CopilotTool<z.ZodVoid, typeof UnspecifiedOutputSchema> = {
    name: openPlanViewToolName,
    description: 'Open the project plan-preview webview that renders `.azure/project-plan.md` and the `.azure/.preview-temp/*.html` pages for user approval.',
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (_, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${openPlanViewToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: openPlanViewToolName, extras }, async (corContext) => {
                await openPlanViewFromWorkspace(corContext);
                return { message: l10n.t('Opened the Plan view.') };
            });
        }) ?? {
            message: l10n.t('Failed to open the Plan view.'),
        };
    }
};
