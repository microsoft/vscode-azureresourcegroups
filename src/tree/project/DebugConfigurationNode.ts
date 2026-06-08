/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ProgressNode } from './ProgressNode';
import { DebugConfigurationSummary } from './projectPlanFiles';

export class DebugConfigurationNode implements ProgressNode {
    constructor(
        private readonly stageId: string,
        private readonly config: DebugConfigurationSummary,
    ) { }

    getChildren(): ProgressNode[] {
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        const { name, folder } = this.config;
        const item = new vscode.TreeItem(vscode.l10n.t('Debug: {0}', name), vscode.TreeItemCollapsibleState.None);
        item.id = `${this.stageId}.debug.${folder.uri.toString()}.${name}`;
        item.iconPath = new vscode.ThemeIcon('debug-alt');
        item.tooltip = vscode.l10n.t('Start debugging "{0}"', name);
        item.command = {
            command: 'workbench.action.debug.selectandstart',
            title: '',
            arguments: [name],
        };
        return item;
    }
}
