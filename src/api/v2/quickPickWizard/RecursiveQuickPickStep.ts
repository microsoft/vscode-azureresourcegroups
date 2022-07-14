/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWizardOptions } from '@microsoft/vscode-azext-utils';
import { ResourceModelBase } from '../v2AzureResourcesApi';
import { GenericQuickPickStep } from './GenericQuickPickStep';
import { QuickPickWizardContext } from './QuickPickWizardContext';

export class RecursiveQuickPickStep<TModel extends ResourceModelBase> extends GenericQuickPickStep<TModel> {
    public async getSubWizard(wizardContext: QuickPickWizardContext<TModel>): Promise<IWizardOptions<QuickPickWizardContext<TModel>> | undefined> {
        if (this.contextValueFilter.matches(wizardContext.currentNode as TModel)) {
            return undefined;
        } else {
            return {
                hideStepCount: true,
                promptSteps: [
                    new RecursiveQuickPickStep(this.treeDataProvider, this.contextValueFilter),
                ]
            }
        }
    }
}
