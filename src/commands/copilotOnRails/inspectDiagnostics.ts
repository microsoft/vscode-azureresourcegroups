/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { DiagnosticsMetadata, getDiagnosticsMetadata } from '../../utils/copilotOnRails/diagnosticUtils';

/**
 * Opens the workspace-cached Copilot on Rails diagnostics in a new JSON editor so they can be
 * inspected on-demand.
 */
export async function inspectDiagnostics(context: IActionContext): Promise<void> {
    context.telemetry.properties.isCopilotEvent = 'true';

    const metadata: DiagnosticsMetadata = getDiagnosticsMetadata();
    if (!metadata.prompt && !metadata.createdAt && metadata.diagnosticEvents.length === 0) {
        void vscode.window.showInformationMessage(vscode.l10n.t('No Copilot on Rails diagnostics have been recorded for this workspace yet.'));
        return;
    }

    const document = await vscode.workspace.openTextDocument({
        language: 'json',
        content: JSON.stringify(metadata, null, 4),
    });
    await vscode.window.showTextDocument(document);
}
