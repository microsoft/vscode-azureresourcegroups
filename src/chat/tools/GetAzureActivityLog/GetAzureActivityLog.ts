/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtLMTool } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { getSelectedActivityItemId, resetSelectedActivityItemId } from '../../askAgentAboutActivityLog';
import { convertActivityTreeToSimpleObjectArray, ConvertedActivityItem } from './convertActivityTree';
import { GetAzureActivityLogContext } from './GetAzureActivityLogContext';

export class GetAzureActivityLog implements AzExtLMTool<void> {
    public async invoke(context: GetAzureActivityLogContext): Promise<vscode.LanguageModelToolResult> {
        context.selectedTreeItemId = getSelectedActivityItemId();

        const convertedActivityItems: ConvertedActivityItem[] = await convertActivityTreeToSimpleObjectArray(context);
        logTelemetry(context, convertedActivityItems);

        if (convertedActivityItems.length === 0) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No activity log items found.')]);
        }

        if (context.selectedTreeItemId && !context.hasSelectedTreeItem) {
            const warning: string = vscode.l10n.t('Tree item ID mismatch - failed to instruct Copilot to focus on the selected item.');
            void vscode.window.showWarningMessage(warning);
            ext.outputChannel.warn(warning);
        }

        let lmTextParts: vscode.LanguageModelTextPart[] = [];
        if (context.hasSelectedTreeItem) {
            lmTextParts.push(new vscode.LanguageModelTextPart(`Focus on the tree item marked as "selected". Provide a helpful explanation of the targeted activity item. It may be helpful to incorporate information from the activity item's parent or siblings (especially any activity attributes, if they exist).`));
        }

        lmTextParts.push(new vscode.LanguageModelTextPart('When explaining data from activity items, prefer explaining the data more conversationally rather than re-providing the raw json data.'));
        lmTextParts = lmTextParts.concat(convertedActivityItems.map(item => new vscode.LanguageModelTextPart(JSON.stringify(item))));

        resetSelectedActivityItemId();
        return new vscode.LanguageModelToolResult(lmTextParts);
    }
}

type TelemetryCounters = {
    callbackIds: Set<string>;
    failedCallbackIds: Set<string>;
    callbackIdsWithAttributes: Set<string>;
    failedCallbackIdsWithAttributes: Set<string>;
    totalFailedActivities: number;
};

function logTelemetry(context: GetAzureActivityLogContext, convertedActivityItems: ConvertedActivityItem[]) {
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

    if (context.selectedTreeItemId) {
        context.telemetry.properties.selectedTreeItemId = context.selectedTreeItemId;
        context.telemetry.properties.hasSelectedTreeItem = String(!!context.hasSelectedTreeItem);
        context.telemetry.properties.selectedTreeItemCallbackId = context.selectedTreeItemCallbackId;
    }

    // i.e. total activities
    context.telemetry.properties.activityCount = String(convertedActivityItems.length);
    context.telemetry.properties.failedActivityCount = String(telemetry.totalFailedActivities);

    // i.e. unique command ids
    context.telemetry.properties.uniqueCallbackIds = Array.from(telemetry.callbackIds).join(',');
    context.telemetry.properties.uniqueFailedCallbackIds = Array.from(telemetry.failedCallbackIds).join(',');

    // i.e. unique command ids w/ command metadata
    context.telemetry.properties.uniqueCallbackIdsWithAttributes = Array.from(telemetry.callbackIdsWithAttributes).join(',');
    context.telemetry.properties.uniqueFailedCallbackIdsWithAttributes = Array.from(telemetry.failedCallbackIdsWithAttributes).join(',');
}
