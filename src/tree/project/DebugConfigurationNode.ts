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
        const { name, type, folder } = this.config;
        const label = name.toLowerCase() === type.toLowerCase() ? vscode.l10n.t('Debug: {0} ({1})', name, folder.name) : vscode.l10n.t('Debug: {0}', name);
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.id = `${this.stageId}.debug.${folder.uri.toString()}.${name}`;
        item.iconPath = new vscode.ThemeIcon('debug-alt');
        item.tooltip = vscode.l10n.t('Start debugging "{0}"', name);
        item.command = {
            command: 'azureResourceGroups.startDebugging',
            title: '',
            arguments: [folder, name],
        };
        return item;
    }
}
