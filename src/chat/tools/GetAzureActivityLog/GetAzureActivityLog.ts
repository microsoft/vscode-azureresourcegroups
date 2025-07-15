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

        type ReduceCounters = { commandIds: string[]; failedCommandIds: string[], totalFailedActivities: number };
        const { commandIds, failedCommandIds, totalFailedActivities } = convertedActivityItems.reduce<ReduceCounters>((counter, activityItem) => {
            if (activityItem.error) {
                counter.totalFailedActivities++;
            }

            if (activityItem.commandId) {
                counter.commandIds.push(activityItem.commandId);

                if (activityItem.error) {
                    counter.failedCommandIds.push(activityItem.commandId);
                }
            }

            return counter;
        }, { commandIds: [], failedCommandIds: [], totalFailedActivities: 0 });

        context.telemetry.properties.activityCount = String(convertedActivityItems.length);
        context.telemetry.properties.failedActivityCount = String(totalFailedActivities);

        context.telemetry.properties.commandIds = commandIds.join(',');
        context.telemetry.properties.failedCommandIds = failedCommandIds.join(',');

        if (convertedActivityItems.length === 0) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No activity log items found.')]);
        }

        return new vscode.LanguageModelToolResult(convertedActivityItems.map(item => new vscode.LanguageModelTextPart(JSON.stringify(item))));
    }
}
