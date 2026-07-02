/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ProgressNode } from './ProgressNode';

export type ProgressState = 'completed' | 'current' | 'notStarted';

export const notStartedDecorationScheme = 'azure-project-progress-notstarted';

export abstract class StageNode implements ProgressNode {
    protected abstract readonly stageId: string;
    protected abstract readonly label: string;
    protected abstract readonly stepNumber: number;
    protected abstract readonly stepIndex: number;
    protected abstract readonly iconName: string;

    constructor(
        protected readonly currentStage: number,
        protected readonly hasPlanFile: boolean,
        /** When set, this stage is the interrupted one and should offer a Resume action. */
        protected readonly resumeCommandId?: string,
        /** Human-readable label of the phase being resumed, shown on the Resume node. */
        protected readonly resumeLabel?: string,
    ) { }

    abstract getChildren(): ProgressNode[];

    getTreeItem(): vscode.TreeItem {
        const state = this.state;
        const item = new vscode.TreeItem(
            vscode.l10n.t('{0}. {1}', this.stepNumber.toString(), this.label),
            state === 'current'
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.id = `${this.stageId}.${state}`;
        item.description = toStateText(state);
        item.tooltip = new vscode.MarkdownString(`**${this.label}** — ${toStateText(state)}`);
        item.iconPath = this.toStageIcon(state);
        if (state === 'notStarted') {
            item.resourceUri = vscode.Uri.from({ scheme: notStartedDecorationScheme, path: `/${this.stageId}` });
        }
        return item;
    }

    protected get state(): ProgressState {
        if (this.stepIndex < this.currentStage) {
            return 'completed';
        }
        if (this.stepIndex === this.currentStage) {
            return 'current';
        }
        return 'notStarted';
    }

    private toStageIcon(state: ProgressState): vscode.ThemeIcon {
        switch (state) {
            case 'completed':
                return new vscode.ThemeIcon('pass-filled');
            case 'current':
                return new vscode.ThemeIcon(this.iconName);
            default:
                return new vscode.ThemeIcon(this.iconName, new vscode.ThemeColor('disabledForeground'));
        }
    }
}

function toStateText(state: ProgressState): string {
    switch (state) {
        case 'completed':
            return vscode.l10n.t('Completed');
        case 'current':
            return vscode.l10n.t('Current');
        default:
            return vscode.l10n.t('Not started');
    }
}
