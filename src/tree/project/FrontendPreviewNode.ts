/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ActionNode } from './ActionNode';

/**
 * A child of the Project Creation stage that re-opens the frontend preview
 * webview once the frontend has been scaffolded, so users can view the running
 * app again after the initial approval.
 */
export class FrontendPreviewNode extends ActionNode {
    constructor(stageId: string, openFrontendPreviewCommandId: string) {
        super({
            stageId,
            idSuffix: 'frontendPreview',
            label: vscode.l10n.t('Preview frontend'),
            icon: 'browser',
            commandId: openFrontendPreviewCommandId,
        });
    }
}
