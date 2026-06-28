/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import { l10n } from "vscode";
import { z } from "zod";
import { ext } from "../../../../extensionVariables";
import { ActivitySelectedCache } from "../../../askAgentAboutActivityLog/ActivitySelectedCache";
import { GetAzureActivityLogContext } from "./GetAzureActivityLogContext";
import { convertActivityTreeToSimpleObjectArray, ConvertedActivityItem, ExcludedActivityItem } from "./convertActivityTree";
import { logActivityTelemetry, logSelectedActivityTelemetry } from "./logTelemetry";

const getAzureActivityLogToolName = 'get_azure_activity_log';

export const getAzureActivityLogTool: CopilotTool<z.ZodVoid, typeof UnspecifiedOutputSchema> = {
    name: getAzureActivityLogToolName,
    description: 'Get the Azure activity log from VS Code.',
    annotations: {
        readOnlyHint: true,
        idempotentHint: true,
    },
    execute: async (_, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${getAzureActivityLogToolName}/execute`, async (context: IActionContext) => {
            context.telemetry.properties.isCopilotEvent = 'true';
            context.telemetry.properties.sessionId = extras?.sessionId;
            context.telemetry.properties.requestId = extras?.requestId.toString();
            return await getAzureActivityLog(context);
        }) ?? {};
    }
};

async function getAzureActivityLog(actionContext: IActionContext): Promise<{ instructions: string; activityItems: string[] }> {
    const context: GetAzureActivityLogContext = Object.assign(actionContext, { activitySelectedCache: ActivitySelectedCache.getInstance() });

    const convertedActivityItems: ConvertedActivityItem[] = await convertActivityTreeToSimpleObjectArray(context);
    logActivityTelemetry(context, convertedActivityItems);

    let selectedActivityItems: ConvertedActivityItem[] = convertedActivityItems.filter(item => !(item as ExcludedActivityItem)._exclude);
    logSelectedActivityTelemetry(context, selectedActivityItems);

    if (!context.activitySelectedCache.selectionCount) {
        // If no items were selected (e.g. invoked mcp without using a VS Code command), default to providing the entire activity tree.
        selectedActivityItems = convertedActivityItems;
    } else if (selectedActivityItems.length !== context.activitySelectedCache.selectionCount) {
        // If we weren't able to verify all of the selected items, fallback to providing the entire activity tree
        selectedActivityItems = convertedActivityItems;

        const warning: string = l10n.t('Failed to provide some of the selected item(s) to Copilot. Falling back to providing the entire activity log tree.');
        void context.ui.showWarningMessage(warning);
        ext.outputChannel.warn(warning);
    }

    context.activitySelectedCache.reset();

    if (selectedActivityItems.length === 0) {
        return {
            instructions: `No activity log items found.`,
            activityItems: [],
        };
    }

    return {
        instructions:
            'Explain the data from the following activity items. Prefer explaining the data more conversationally rather than responding with the raw json data. ' +
            'The activities provided are in chronological order.',
        activityItems: selectedActivityItems.map(item => JSON.stringify(item)),
    };
}
