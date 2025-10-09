/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtLMTool, IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { ActivitySelectionCache } from '../../askAgentAboutActivityLog/ActivitySelectionCache';
import { convertActivityTreeToSimpleObjectArray, ConvertedActivityItem, ExcludedActivityItem } from './convertActivityTree';
import { GetAzureActivityLogContext } from './GetAzureActivityLogContext';
import { logActivityTelemetry, logSelectedActivityTelemetry } from './logTelemetry';

export class GetAzureActivityLog implements AzExtLMTool<void> {
    public async invoke(invocationContext: IActionContext): Promise<vscode.LanguageModelToolResult> {
        const context: GetAzureActivityLogContext = Object.assign(invocationContext, { activitySelectionCache: ActivitySelectionCache.getInstance() });

        const convertedActivityItems: ConvertedActivityItem[] = await convertActivityTreeToSimpleObjectArray(context);
        logActivityTelemetry(context, convertedActivityItems);

        let selectedActivityItems: ConvertedActivityItem[] = convertedActivityItems;
        if (context.activitySelectionCache.selectionCount) {
            selectedActivityItems = convertedActivityItems.filter(item => !(item as ExcludedActivityItem)._exclude);
            logSelectedActivityTelemetry(context, selectedActivityItems);
        }

        // If we weren't able to verify all of the selected items, fallback to providing the entire activity tree
        if (selectedActivityItems.length !== context.activitySelectionCache.selectionCount) {
            selectedActivityItems = convertedActivityItems;

            const warning: string = vscode.l10n.t('Failed to provide some of the selected item(s) to Copilot. Falling back to providing the entire activity log tree.');
            void context.ui.showWarningMessage(warning);
            ext.outputChannel.warn(warning);
        }

        context.activitySelectionCache.reset();

        if (selectedActivityItems.length === 0) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No activity log items found.')]);
        }

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('When explaining data from activity items, prefer explaining the data more conversationally rather than re-providing the raw json data.'),
            ...selectedActivityItems.map(item => new vscode.LanguageModelTextPart(JSON.stringify(item))),
        ]);
    }
}
