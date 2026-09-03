/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ProgressNode } from './ProgressNode';

export class StateStageNode implements ProgressNode {
    constructor(
        private readonly stageId: string,
        private readonly startCommandId: string,
        private readonly label = vscode.l10n.t('Start'),
    ) { }

    getChildren(): ProgressNode[] {
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        const item = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.None);
        item.id = `${this.stageId}.start`;
        item.iconPath = new vscode.ThemeIcon('play-circle');
        item.tooltip = this.label;
        item.command = {
            command: this.startCommandId,
            title: '',
        };
        return item;
    }
}
