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
    commandIds: string[];
    failedCommandIds: string[];
    commandIdsWithAttributes: string[];
    failedCommandIdsWithAttributes: string[];
    totalFailedActivities: number;
};

function logTelemetry(context: IActionContext, convertedActivityItems: ConvertedActivityItem[]) {
    const telemetry: TelemetryCounters = convertedActivityItems.reduce<TelemetryCounters>((telemetry, activityItem) => {
        if (activityItem.error) {
            telemetry.totalFailedActivities++;
        }

        const commandId: string | undefined = activityItem.activityAttributes?.commandId;
        if (commandId) {
            telemetry.commandIds.push(commandId);
            if (activityItem.activityAttributes) {
                telemetry.commandIdsWithAttributes.push(commandId);
            }


            if (activityItem.error) {
                telemetry.failedCommandIds.push(commandId);
                if (activityItem.activityAttributes) {
                    telemetry.failedCommandIdsWithAttributes.push(commandId);
                }
            }
        }

        return telemetry;

    }, {
        commandIds: [],
        failedCommandIds: [],
        commandIdsWithAttributes: [],
        failedCommandIdsWithAttributes: [],
        totalFailedActivities: 0,
    });

    context.telemetry.properties.activityCount = String(convertedActivityItems.length);
    context.telemetry.properties.failedActivityCount = String(telemetry.totalFailedActivities);

    context.telemetry.properties.commandIds = telemetry.commandIds.join(',');
    context.telemetry.properties.failedCommandIds = telemetry.failedCommandIds.join(',');

    context.telemetry.properties.commandIdsWithAttributes = telemetry.commandIdsWithAttributes.join(',');
    context.telemetry.properties.failedCommandIdsWithAttributes = telemetry.failedCommandIdsWithAttributes.join(',');
}
