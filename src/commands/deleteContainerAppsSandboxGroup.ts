/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseAzureResourceId } from '@microsoft/vscode-azext-azureutils';
import { AzureWizard, AzureWizardExecuteStepWithActivityOutput, ExecuteActivityContext, IActionContext, ISubscriptionContext, createSubscriptionContext, nonNullProp } from '@microsoft/vscode-azext-utils';
import { Progress } from 'vscode';
import { AzureResource } from '../../api/src/index';
import { markAzureResourceDeleted } from '../api/DefaultAzureResourceProvider';
import { ext } from '../extensionVariables';
import { AzureResourceItem } from '../tree/azure/AzureResourceItem';
import { createActivityContext } from '../utils/activityUtils';
import { createContainerAppsSandboxClient } from '../utils/containerAppsSandboxClient';
import { localize } from '../utils/localize';

interface DeleteSandboxGroupContext extends IActionContext, ExecuteActivityContext {
    resourceGroupName: string;
    sandboxGroupName: string;
    subscription: ISubscriptionContext;
}

export async function deleteContainerAppsSandboxGroup(context: IActionContext, node: AzureResourceItem<AzureResource>): Promise<void> {
    const { resourceGroup, resourceName } = parseAzureResourceId(node.resource.id);
    const confirmMessage = localize(
        'confirmDeleteSandboxGroup',
        'Are you sure you want to delete sandbox group "{0}"? All sandboxes and resources inside this group will be permanently deleted.',
        resourceName,
    );
    await context.ui.showWarningMessage(confirmMessage, { modal: true }, { title: localize('delete', 'Delete') });

    const subscription = createSubscriptionContext(node.resource.subscription);
    const wizardContext: DeleteSandboxGroupContext = {
        ...context,
        ...await createActivityContext(),
        activityTitle: localize('deleteSandboxGroupNamed', 'Delete sandbox group "{0}"', resourceName),
        resourceGroupName: resourceGroup,
        sandboxGroupName: resourceName,
        subscription,
        suppressProgress: true,
    };
    const wizard = new AzureWizard(wizardContext, {
        executeSteps: [new SandboxGroupDeleteStep()],
    });

    await ext.azureTreeState.runWithTemporaryDescription(
        node.id,
        localize('deleting', 'Deleting...'),
        async () => wizard.execute(),
        () => ext.actions.refreshAzureTree(node),
    );
    markAzureResourceDeleted(node.resource.id);
    ext.setClearCacheOnNextLoad('azure');
    ext.actions.refreshAzureTree();
}

class SandboxGroupDeleteStep extends AzureWizardExecuteStepWithActivityOutput<DeleteSandboxGroupContext> {
    readonly priority = 100;
    readonly stepName = 'deleteSandboxGroup';

    async execute(context: DeleteSandboxGroupContext, progress: Progress<{ message?: string; increment?: number }>): Promise<void> {
        const name = nonNullProp(context, 'sandboxGroupName');
        progress.report({ message: localize('deletingSandboxGroup', 'Deleting sandbox group "{0}"...', name) });

        const client = await createContainerAppsSandboxClient(context.subscription);
        const poller = client.sandboxGroups.beginDelete(context.resourceGroupName, name);
        await poller.pollUntilDone();
    }

    shouldExecute(): boolean {
        return true;
    }

    protected getTreeItemLabel(context: DeleteSandboxGroupContext): string {
        return localize('deleteSandboxGroupNamed', 'Delete sandbox group "{0}"', context.sandboxGroupName);
    }

    protected getOutputLogSuccess(context: DeleteSandboxGroupContext): string {
        return localize('deletedSandboxGroup', 'Deleted sandbox group "{0}".', context.sandboxGroupName);
    }

    protected getOutputLogFail(context: DeleteSandboxGroupContext): string {
        return localize('failedToDeleteSandboxGroup', 'Failed to delete sandbox group "{0}".', context.sandboxGroupName);
    }
}
