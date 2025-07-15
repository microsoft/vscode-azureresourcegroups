/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtLMTool, IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { convertActivityTreeToSimpleObjectArray, ConvertedActivityItem } from './convertActivityTree';

export class GetAzureActivityLog implements AzExtLMTool<void> {
    public async invoke(context: IActionContext): Promise<vscode.LanguageModelToolResult> {
        const convertedActivityItems: ConvertedActivityItem[] = await convertActivityTreeToSimpleObjectArray(context);
        logTelemetry(context, convertedActivityItems);

        if (convertedActivityItems.length === 0) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No activity log items found.')]);
        }

        return new vscode.LanguageModelToolResult(convertedActivityItems.map(item => new vscode.LanguageModelTextPart(JSON.stringify(item))));
    }
}

type TelemetryCounters = {
    commandIds: Set<string>;
    failedCommandIds: Set<string>;
    commandIdsWithAttributes: Set<string>;
    failedCommandIdsWithAttributes: Set<string>;
    totalFailedActivities: number;
};

function logTelemetry(context: IActionContext, convertedActivityItems: ConvertedActivityItem[]) {
    const telemetry: TelemetryCounters = convertedActivityItems.reduce<TelemetryCounters>((telemetry, activityItem) => {
        if (activityItem.error) {
            telemetry.totalFailedActivities++;
        }

        if (activityItem.commandId) {
            telemetry.commandIds.add(activityItem.commandId);
            if (activityItem.activityAttributes) {
                telemetry.commandIdsWithAttributes.add(activityItem.commandId);
            }


            if (activityItem.error) {
                telemetry.failedCommandIds.add(activityItem.commandId);
                if (activityItem.activityAttributes) {
                    telemetry.failedCommandIdsWithAttributes.add(activityItem.commandId);
                }
            }
        }

        return telemetry;

    }, {
        commandIds: new Set(),
        failedCommandIds: new Set(),
        commandIdsWithAttributes: new Set(),
        failedCommandIdsWithAttributes: new Set(),
        totalFailedActivities: 0,
    });

    context.telemetry.properties.activityCount = String(convertedActivityItems.length);
    context.telemetry.properties.failedActivityCount = String(telemetry.totalFailedActivities);

    context.telemetry.properties.uniqueCommandIds = Array.from(telemetry.commandIds).join(',');
    context.telemetry.properties.uniqueFailedCommandIds = Array.from(telemetry.failedCommandIds).join(',');

    context.telemetry.properties.uniqueCommandIdsWithAttributes = Array.from(telemetry.commandIdsWithAttributes).join(',');
    context.telemetry.properties.uniqueFailedCommandIdsWithAttributes = Array.from(telemetry.failedCommandIdsWithAttributes).join(',');
}
