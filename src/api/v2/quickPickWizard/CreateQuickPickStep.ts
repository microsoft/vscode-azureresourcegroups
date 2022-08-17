/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { localize } from '../../../utils/localize';
import { Filter, ResourceModelBase } from '../v2AzureResourcesApi';
import { GenericQuickPickStep } from './GenericQuickPickStep';
import { QuickPickWizardContext } from './QuickPickWizardContext';

type CreateCallback = () => vscode.ProviderResult<never>;

export class CreateQuickPickStep<TModel extends ResourceModelBase> extends GenericQuickPickStep<TModel> {
    public constructor(treeDataProvider: vscode.TreeDataProvider<TModel>, contextValueFilter: Filter<ResourceModelBase>, private readonly createCallback: CreateCallback) {
        super(treeDataProvider, contextValueFilter);
    }

    public override async prompt(wizardContext: QuickPickWizardContext<TModel>): Promise<void> {
        const picks: IAzureQuickPickItem<TModel | CreateCallback>[] = await this.getPicks(wizardContext);
        picks.push(this.getCreatePick());

        const selected = await wizardContext.ui.showQuickPick(picks, { /* TODO: options */ });
        if (typeof selected.data === 'function') {
            const callback = selected.data as CreateCallback;
            await callback();
        } else {
            wizardContext.currentNode = selected.data;
        }
    }

    private getCreatePick(): IAzureQuickPickItem<CreateCallback> {
        return {
            label: localize('createQuickPickLabel', '$(add) Create...'),
            data: this.createCallback,
        };
    }
}
