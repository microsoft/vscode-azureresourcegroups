/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IResourceGroupWizardContext, LocationListStep, ResourceGroupCreateStep, ResourceGroupListStep } from '@microsoft/vscode-azext-azureutils';
import { AzureWizard, AzureWizardExecuteStepWithActivityOutput, AzureWizardPromptStep, ExecuteActivityContext, IActionContext, createSubscriptionContext, nonNullProp, subscriptionExperience } from '@microsoft/vscode-azext-utils';
import { randomBytes } from 'crypto';
import { Progress, l10n } from 'vscode';
import { AzureSubscription } from '../../api/src/index';
import { ext } from '../extensionVariables';
import { GroupingItem } from '../tree/azure/grouping/GroupingItem';
import { createActivityContext } from '../utils/activityUtils';
import { createContainerAppsSandboxClient } from '../utils/containerAppsSandboxClient';
import { localize } from '../utils/localize';

interface CreateSandboxGroupContext extends IResourceGroupWizardContext, ExecuteActivityContext {
    newSandboxGroupName?: string;
    subscription: ReturnType<typeof createSubscriptionContext>;
}

export async function createContainerAppsSandboxGroup(context: IActionContext, node?: GroupingItem): Promise<void> {
    let subscription: AzureSubscription | undefined = node?.subscription;
    if (!subscription) {
        subscription = await subscriptionExperience(context, ext.v2.api.resources.azureResourceTreeDataProvider);
    }

    const wizardContext: CreateSandboxGroupContext = {
        ...context,
        ...createSubscriptionContext(subscription),
        ...await createActivityContext(),
        subscription: createSubscriptionContext(subscription),
        suppress403Handling: true,
        suppressProgress: true,
    };

    const promptSteps: AzureWizardPromptStep<CreateSandboxGroupContext>[] = [
        new SandboxGroupNameStep(),
        new ResourceGroupListStep(),
    ];
    LocationListStep.addStep(wizardContext, promptSteps);

    const wizard = new AzureWizard(wizardContext, {
        title: localize('createSandboxGroup', 'Create Sandbox Group'),
        promptSteps,
        executeSteps: [
            new ResourceGroupCreateStep(),
            new SandboxGroupCreateStep(),
        ],
    });

    await wizard.prompt();
    const sandboxGroupName = nonNullProp(wizardContext, 'newSandboxGroupName');
    wizardContext.activityTitle = localize('createSandboxGroupNamed', 'Create sandbox group "{0}"', sandboxGroupName);
    if (node) {
        await ext.azureTreeState.showCreatingChild(
            node.id,
            sandboxGroupName,
            async () => wizard.execute(),
            () => ext.actions.refreshAzureTree(node),
        );
    } else {
        await wizard.execute();
    }

    ext.setClearCacheOnNextLoad('azure');
    ext.actions.refreshAzureTree();
}

class SandboxGroupNameStep extends AzureWizardPromptStep<CreateSandboxGroupContext> {
    async prompt(context: CreateSandboxGroupContext): Promise<void> {
        context.newSandboxGroupName = await context.ui.showInputBox({
            prompt: l10n.t('Enter a name for the sandbox group.'),
            value: generateSandboxGroupName(),
            validateInput: validateSandboxGroupName,
        });
    }

    shouldPrompt(context: CreateSandboxGroupContext): boolean {
        return !context.newSandboxGroupName;
    }
}

class SandboxGroupCreateStep extends AzureWizardExecuteStepWithActivityOutput<CreateSandboxGroupContext> {
    readonly priority = 200;
    readonly stepName = 'createSandboxGroup';

    async execute(context: CreateSandboxGroupContext, progress: Progress<{ message?: string; increment?: number }>): Promise<void> {
        const name = nonNullProp(context, 'newSandboxGroupName');
        const resourceGroup = nonNullProp(context, 'resourceGroup');
        const resourceGroupName = nonNullProp(resourceGroup, 'name');
        const location = await LocationListStep.getLocation(context);
        progress.report({ message: localize('creatingSandboxGroup', 'Creating sandbox group "{0}"...', name) });

        const client = await createContainerAppsSandboxClient(context.subscription);
        const poller = client.sandboxGroups.beginCreateOrUpdate(resourceGroupName, name, { location: location.name });
        await poller.pollUntilDone();
    }

    shouldExecute(): boolean {
        return true;
    }

    protected getTreeItemLabel(context: CreateSandboxGroupContext): string {
        return localize('createSandboxGroupNamed', 'Create sandbox group "{0}"', nonNullProp(context, 'newSandboxGroupName'));
    }

    protected getOutputLogSuccess(context: CreateSandboxGroupContext): string {
        return localize('createdSandboxGroup', 'Created sandbox group "{0}".', nonNullProp(context, 'newSandboxGroupName'));
    }

    protected getOutputLogFail(context: CreateSandboxGroupContext): string {
        return localize('failedToCreateSandboxGroup', 'Failed to create sandbox group "{0}".', nonNullProp(context, 'newSandboxGroupName'));
    }
}

export function validateSandboxGroupName(name: string): string | undefined {
    if (!/^[a-z](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(name)) {
        return l10n.t('The name must be 1-32 characters, contain only lowercase letters, numbers, and hyphens, start with a letter, and end with a letter or number.');
    }

    return undefined;
}

export function generateSandboxGroupName(randomBytesProvider: (size: number) => Buffer = randomBytes): string {
    return `sandbox-group-${randomBytesProvider(2).toString('hex')}`;
}
