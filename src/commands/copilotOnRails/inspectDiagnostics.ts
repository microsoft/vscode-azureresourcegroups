/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { getDiagnosticEvents } from '../../utils/copilotOnRails/copilotOnRailsLogUtils';

/**
 * Opens the cached Copilot on Rails diagnostic events in a new JSON editor so they can be
 * inspected after a run. This surfaces only the workspace-cached events.
 */
export async function inspectDiagnostics(context: IActionContext): Promise<void> {
    context.telemetry.properties.isCopilotEvent = 'true';

    const events = getDiagnosticEvents();
    if (events.length === 0) {
        void vscode.window.showInformationMessage(vscode.l10n.t('No Copilot on Rails diagnostic events have been recorded for this workspace yet.'));
        return;
    }

    const document = await vscode.workspace.openTextDocument({
        language: 'json',
        content: JSON.stringify(events, null, 4),
    });
    await vscode.window.showTextDocument(document);
}
