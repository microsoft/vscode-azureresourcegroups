/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ProgressNode } from './ProgressNode';

export class OpenPlanNode implements ProgressNode {
    constructor(
        private readonly stageId: string,
        private readonly openPlanCommandId: string,
    ) { }

    getChildren(): ProgressNode[] {
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        const label = vscode.l10n.t('Open plan');
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.id = `${this.stageId}.openPlan`;
        item.iconPath = new vscode.ThemeIcon('preview');
        item.tooltip = label;
        item.command = {
            command: this.openPlanCommandId,
            title: '',
        };
        return item;
    }
}
