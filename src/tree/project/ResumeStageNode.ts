/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { copilotOnRailsCommandIds } from '../../webviews/copilotOnRails/extension/copilotOnRailsCommands';
import { ProgressNode } from './ProgressNode';

/**
 * Child action node shown under the current stage when an interrupted
 * create-with-copilot run is detected. Invokes the resume command so the user
 * is dropped back into the correct phase without browsing chat history.
 */
export class ResumeStageNode implements ProgressNode {
    constructor(
        private readonly stageId: string,
    ) { }

    getChildren(): ProgressNode[] {
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        const label = vscode.l10n.t('Resume');
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.id = `${this.stageId}.resume`;
        item.iconPath = new vscode.ThemeIcon('debug-continue');
        item.tooltip = vscode.l10n.t('Resume this step where you left off');
        // Always route through the single resume entry point so the resolved
        // flow state (including phase-specific resume prompts/args) is applied,
        // rather than invoking a raw phase command with its default prompt.
        item.command = {
            command: copilotOnRailsCommandIds.resumeProjectWithCopilot,
            title: '',
        };
        return item;
    }
}
