/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceModelBase } from '../v2AzureResourcesApi';
import { QuickPickWizardContext } from './QuickPickWizardContext';
import { RecursiveQuickPickStep } from './RecursiveQuickPickStep';

export class SkipIfOneQuickPickStep<TModel extends ResourceModelBase> extends RecursiveQuickPickStep<TModel> {
    public override async prompt(wizardContext: QuickPickWizardContext<TModel>): Promise<void> {
        const picks = await this.getPicks(wizardContext);

        if (picks.length === 1) {
            wizardContext.currentNode = picks[0].data;
        } else {
            const selected = await wizardContext.ui.showQuickPick(await this.getPicks(wizardContext), { /* TODO: options */ });
            wizardContext.currentNode = selected.data;
        }
    }
}
