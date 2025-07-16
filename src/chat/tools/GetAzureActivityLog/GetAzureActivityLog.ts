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
    callbackIds: Set<string>;
    failedCallbackIds: Set<string>;
    callbackIdsWithAttributes: Set<string>;
    failedCallbackIdsWithAttributes: Set<string>;
    totalFailedActivities: number;
};

function logTelemetry(context: IActionContext, convertedActivityItems: ConvertedActivityItem[]) {
    const telemetry: TelemetryCounters = convertedActivityItems.reduce<TelemetryCounters>((telemetry, activityItem) => {
        if (activityItem.error) {
            telemetry.totalFailedActivities++;
        }

        if (activityItem.callbackId) {
            telemetry.callbackIds.add(activityItem.callbackId);
            if (activityItem.activityAttributes) {
                telemetry.callbackIdsWithAttributes.add(activityItem.callbackId);
            }


            if (activityItem.error) {
                telemetry.failedCallbackIds.add(activityItem.callbackId);
                if (activityItem.activityAttributes) {
                    telemetry.failedCallbackIdsWithAttributes.add(activityItem.callbackId);
                }
            }
        }

        return telemetry;

    }, {
        callbackIds: new Set(),
        failedCallbackIds: new Set(),
        callbackIdsWithAttributes: new Set(),
        failedCallbackIdsWithAttributes: new Set(),
        totalFailedActivities: 0,
    });

    // i.e. activity totals
    context.telemetry.properties.activityCount = String(convertedActivityItems.length);
    context.telemetry.properties.failedActivityCount = String(telemetry.totalFailedActivities);

    // i.e. commands w/ ids
    context.telemetry.properties.uniqueCallbackIds = Array.from(telemetry.callbackIds).join(',');
    context.telemetry.properties.uniqueFailedCallbackIds = Array.from(telemetry.failedCallbackIds).join(',');

    // i.e. commands w/ command metadata
    context.telemetry.properties.uniqueCallbackIdsWithAttributes = Array.from(telemetry.callbackIdsWithAttributes).join(',');
    context.telemetry.properties.uniqueFailedCallbackIdsWithAttributes = Array.from(telemetry.failedCallbackIdsWithAttributes).join(',');
}
