/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ProgressNode } from './ProgressNode';
import { StageNode } from './StageNode';

export const ciCdSurveyUrl = 'https://aka.ms/CICDSurvey';

class CiCdSurveyNode implements ProgressNode {
    getChildren(): ProgressNode[] {
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        const label = vscode.l10n.t('Take survey');
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.id = 'azureProject.stage.ciCd.survey';
        item.iconPath = new vscode.ThemeIcon('link-external');
        item.tooltip = vscode.l10n.t('Share your CI/CD expectations for Azure tools in VS Code');
        item.command = {
            command: 'vscode.open',
            title: label,
            arguments: [vscode.Uri.parse(ciCdSurveyUrl)],
        };
        return item;
    }
}

export class CiCdStageItem extends StageNode {
    protected readonly stageId = 'azureProject.stage.ciCd';
    protected readonly label = vscode.l10n.t('CI/CD');
    protected readonly stepNumber = 4;
    protected readonly stepIndex = 3;
    protected readonly iconName = 'git-merge';

    constructor(currentStage: number) {
        super(currentStage, false);
    }

    getTreeItem(): vscode.TreeItem {
        const item = super.getTreeItem();
        const status = vscode.l10n.t('Provide Feedback');
        item.description = status;
        item.tooltip = new vscode.MarkdownString(`**${this.label}** — ${status}`);
        return item;
    }

    getChildren(): ProgressNode[] {
        return [new CiCdSurveyNode()];
    }
}
