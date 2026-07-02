/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ProgressNode } from './ProgressNode';

/**
 * A child of the Project Creation stage that re-opens the frontend preview
 * webview once the frontend has been scaffolded, so users can view the running
 * app again after the initial approval.
 */
export class FrontendPreviewNode implements ProgressNode {
    constructor(
        private readonly stageId: string,
        private readonly openFrontendPreviewCommandId: string,
    ) { }

    getChildren(): ProgressNode[] {
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        const label = vscode.l10n.t('Preview frontend');
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.id = `${this.stageId}.frontendPreview`;
        item.iconPath = new vscode.ThemeIcon('browser');
        item.tooltip = label;
        item.command = {
            command: this.openFrontendPreviewCommandId,
            title: '',
        };
        return item;
    }
}
