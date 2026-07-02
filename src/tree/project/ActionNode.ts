/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ProgressNode } from './ProgressNode';

/** Shape of a leaf progress-tree node that runs a command when clicked. */
export interface ActionNodeOptions {
    /** Stage this action belongs to; used to build a stable tree-item id. */
    stageId: string;
    /** Suffix appended to `stageId` to form the tree-item id (e.g. `'resume'`). */
    idSuffix: string;
    /** Primary label shown for the node. */
    label: string;
    /** Codicon id for the node icon. */
    icon: string;
    /** Command id invoked when the node is clicked. */
    commandId: string;
    /** Optional tooltip; defaults to {@link label}. */
    tooltip?: string;
    /** Optional dimmed description shown after the label. */
    description?: string;
}

/**
 * A leaf progress-tree node that invokes a command when clicked. Centralizes the
 * shared `TreeItem` boilerplate for the stage action nodes (Start, Open plan,
 * Resume, Preview frontend, …) so each concrete node only supplies its label,
 * icon, id, and command instead of repeating the same wiring.
 */
export class ActionNode implements ProgressNode {
    constructor(protected readonly options: ActionNodeOptions) { }

    getChildren(): ProgressNode[] {
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        const { stageId, idSuffix, label, icon, commandId, tooltip, description } = this.options;
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.id = `${stageId}.${idSuffix}`;
        item.iconPath = new vscode.ThemeIcon(icon);
        item.description = description;
        item.tooltip = tooltip ?? label;
        item.command = {
            command: commandId,
            title: '',
        };
        return item;
    }
}
