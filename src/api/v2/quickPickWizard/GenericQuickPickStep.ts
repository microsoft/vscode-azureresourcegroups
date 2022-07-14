/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, IAzureQuickPickItem, NoResourceFoundError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { Filter, ResourceModelBase } from '../v2AzureResourcesApi';
import { QuickPickWizardContext } from './QuickPickWizardContext';

export class GenericQuickPickStep<TModel extends ResourceModelBase> extends AzureWizardPromptStep<QuickPickWizardContext<TModel>> {
    public supportsDuplicateSteps = true;

    public constructor(
        protected readonly treeDataProvider: vscode.TreeDataProvider<TModel>,
        protected readonly contextValueFilter: Filter<TModel>,
    ) {
        super();
    }

    public async prompt(wizardContext: QuickPickWizardContext<TModel>): Promise<void> {
        const selected = await wizardContext.ui.showQuickPick(await this.getPicks(wizardContext), { /* TODO: options */ });
        wizardContext.currentNode = selected.data;
    }

    public shouldPrompt(_wizardContext: QuickPickWizardContext<TModel>): boolean {
        return true;
    }

    protected async getPicks(wizardContext: QuickPickWizardContext<TModel>): Promise<IAzureQuickPickItem<TModel>[]> {
        const children = (await this.treeDataProvider.getChildren(wizardContext.currentNode)) || [];

        const matchingChildren = children.filter(this.contextValueFilter.matches);
        const nonLeafChildren = children.filter(c => c.quickPickOptions?.isLeaf === false);

        let promptChoices: TModel[];
        if (matchingChildren.length === 0) {
            if (nonLeafChildren.length === 0) {
                throw new NoResourceFoundError();
            } else {
                promptChoices = nonLeafChildren;
            }
        } else {
            promptChoices = matchingChildren;
        }

        const picks: IAzureQuickPickItem<TModel>[] = [];
        for (const choice of promptChoices) {
            picks.push(await this.getQuickPickItem(choice));
        }

        return picks;
    }

    private async getQuickPickItem(resource: TModel): Promise<IAzureQuickPickItem<TModel>> {
        const treeItem = await Promise.resolve(this.treeDataProvider.getTreeItem(resource));

        return {
            label: ((treeItem.label as vscode.TreeItemLabel)?.label || treeItem.label) as string,
            description: treeItem.description as string,
            data: resource,
        };
    }
}
