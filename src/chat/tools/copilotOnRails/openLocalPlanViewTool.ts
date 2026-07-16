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
import { openLocalPlanViewFromWorkspace } from "../../../webviews/copilotOnRails/extension/openLocalPlanView";

const openLocalPlanViewToolName = 'open_local_plan_view';

export const openLocalPlanViewTool: CopilotTool<z.ZodVoid, typeof UnspecifiedOutputSchema> = {
    name: openLocalPlanViewToolName,
    description: 'Open the Local Development Plan webview for user approval.',
    annotations: {
        openWorldHint: false,
        destructiveHint: false,
    },
    execute: async (_, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${openLocalPlanViewToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: openLocalPlanViewToolName, extras }, async (corContext) => {
                await openLocalPlanViewFromWorkspace(corContext);
                return { message: l10n.t('Opened the Local Development Plan view.') };
            });
        }) ?? {
            message: l10n.t('Failed to open the Local Development Plan view.'),
        };
    }
};
