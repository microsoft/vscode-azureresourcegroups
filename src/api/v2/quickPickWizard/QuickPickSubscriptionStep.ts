/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { ApplicationSubscription, ResourceModelBase } from '../v2AzureResourcesApi';
import { QuickPickAppResourceWizardContext } from './QuickPickAppResourceWizardContext';

export class QuickPickSubscriptionStep<TModel extends ResourceModelBase> extends AzureWizardPromptStep<QuickPickAppResourceWizardContext<TModel>> {
    public async prompt(wizardContext: QuickPickAppResourceWizardContext<TModel>): Promise<void> {
        // TODO: pick subscription
        wizardContext.applicationSubscription = 1 as unknown as ApplicationSubscription;
    }

    public shouldPrompt(_wizardContext: QuickPickAppResourceWizardContext<TModel>): boolean {
        return true;
    }
}
