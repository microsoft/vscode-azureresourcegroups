/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IResourceGroupWizardContext, LocationListStep, ResourceGroupCreateStep, ResourceGroupNameStep } from '@microsoft/vscode-azext-azureutils';
import { AzureWizard, AzureWizardExecuteStep, AzureWizardPromptStep, ExecuteActivityContext, IActionContext, createSubscriptionContext, nonNullProp, subscriptionExperience } from '@microsoft/vscode-azext-utils';
import { window } from 'vscode';
import { AzureSubscription } from '../../api/src/index';
import { ext } from '../extensionVariables';
import { SubscriptionItem } from '../tree/azure/SubscriptionItem';
import { createActivityContext } from '../utils/activityUtils';
import { localize } from '../utils/localize';

export async function createResourceGroup(context: IActionContext, node?: SubscriptionItem): Promise<void> {
    let subscription: AzureSubscription | undefined = node?.subscription;
    if (!subscription) {
        subscription = await subscriptionExperience(context, ext.v2.api.resources.azureResourceTreeDataProvider);
    }

    const wizardContext: IResourceGroupWizardContext & ExecuteActivityContext = {
        ...context,
        ...createSubscriptionContext(subscription),
        suppress403Handling: true,
        ...(await createActivityContext()),
    };

    const title: string = localize('createResourceGroup', 'Create Resource Group');
    const promptSteps: AzureWizardPromptStep<IResourceGroupWizardContext>[] = [new ResourceGroupNameStep()];
    LocationListStep.addStep(wizardContext, promptSteps);
    const executeSteps: AzureWizardExecuteStep<IResourceGroupWizardContext>[] = [new ResourceGroupCreateStep()];
    const wizard: AzureWizard<IResourceGroupWizardContext & ExecuteActivityContext> = new AzureWizard(wizardContext, { title, promptSteps, executeSteps });
    await wizard.prompt();
    const newResourceGroupName = nonNullProp(wizardContext, 'newResourceGroupName');
    wizardContext.activityTitle = localize('createResourceGroup', 'Create resource group "{0}"', newResourceGroupName);
    await wizard.execute();
    if (!wizardContext.suppressNotification) {
        void window.showInformationMessage(localize('createdRg', 'Created resource group "{0}".', newResourceGroupName));
    }
    ext.azureTreeState.notifyChildrenChanged(`/subscriptions/${subscription.subscriptionId}`);
}
