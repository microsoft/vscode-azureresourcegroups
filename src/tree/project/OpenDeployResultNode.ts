/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ProgressNode } from './ProgressNode';

/**
 * Reopens the Deployment results view for the workspace's latest `deploy-result.json`.
 * Only shown once that artifact exists, so the deploy report stays reachable after
 * the user closes its tab.
 */
export class OpenDeployResultNode implements ProgressNode {
    constructor(
        private readonly stageId: string,
        private readonly openDeployResultCommandId: string,
    ) { }

    getChildren(): ProgressNode[] {
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        const label = vscode.l10n.t('Open deployment results');
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.id = `${this.stageId}.openDeployResult`;
        item.iconPath = new vscode.ThemeIcon('cloud-upload');
        item.tooltip = label;
        item.command = {
            command: this.openDeployResultCommandId,
            title: '',
        };
        return item;
    }
}
