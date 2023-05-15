/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceGroup } from '@azure/arm-resources';
import { uiUtils } from '@microsoft/vscode-azext-azureutils';
import { AzureWizard, createSubscriptionContext, IActionContext, IAzureQuickPickItem, nonNullProp, NoResourceFoundError, subscriptionExperience, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { AzureResource, AzureSubscription } from '../../../../api/src/index';
import { createResourceGroup } from '../../../api/DefaultAzureResourceProvider';
import { ext } from '../../../extensionVariables';
import { GroupingItem } from '../../../tree/azure/GroupingItem';
import { createActivityContext } from '../../../utils/activityUtils';
import { createResourceClient } from '../../../utils/azureClients';
import { localize } from '../../../utils/localize';
import { settingUtils } from '../../../utils/settingUtils';
import { DeleteResourceGroupContext } from '../DeleteResourceGroupContext';
import { DeleteResourceGroupStep } from '../DeleteResourceGroupStep';

export async function deleteResourceGroupV2(context: IActionContext, primaryNode?: GroupingItem, selectedNodes?: GroupingItem[]): Promise<void> {

    // unset nodes that are not resource groups
    selectedNodes = selectedNodes?.filter(n => primaryNode instanceof GroupingItem && !!n.resourceGroup);
    if (!(primaryNode instanceof GroupingItem) || !primaryNode?.resourceGroup) {
        primaryNode = undefined;
    }

    const selectedResourceGroupNodes = getSelectedNodes(primaryNode, selectedNodes);

    let subscription: AzureSubscription;
    let resourceGroupsToDelete: AzureResource[] = [];

    if (selectedResourceGroupNodes) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        subscription = selectedResourceGroupNodes[0].subscription!;
        resourceGroupsToDelete = selectedResourceGroupNodes.map(node => nonNullProp(node, 'resourceGroup'));
    } else {
        ({ subscription, resourceGroupsToDelete } = await pickResourceGroups(context));
    }

    await deleteResourceGroups(context, subscription, resourceGroupsToDelete);
}

function isNameEqual(val: string | undefined, name: string): boolean {
    return !!val && val.toLowerCase() === name.toLowerCase();
}

// todo: move somewhere for sharing
function getSelectedNodes<T>(primaryNode?: T, selectedNodes?: T[]): [T, ...T[]] | undefined {
    if (selectedNodes && selectedNodes.length > 0) {
        // tell typescript we know this array has at least one element
        return selectedNodes as [T, ...T[]];
    }

    if (primaryNode) {
        return [primaryNode];
    }

    // no nodes selected
    return undefined;
}

async function pickResourceGroups(context: IActionContext) {
    const subscription = await subscriptionExperience(context, ext.v2.api.resources.azureResourceTreeDataProvider);
    const client = await createResourceClient([context, createSubscriptionContext(subscription)]);
    const resourceGroups = await uiUtils.listAllIterator(client.resourceGroups.list());

    if (!resourceGroups.length) {
        throw new NoResourceFoundError();
    }

    const picks = resourceGroups
        .map(rg => ({ label: nonNullProp(rg, 'name'), data: rg }))
        .sort((a, b) => a.label.localeCompare(b.label));

    const pickedResourceGroups = await context.ui.showQuickPick<IAzureQuickPickItem<ResourceGroup>>(picks, {
        canPickMany: true,
        placeHolder: localize('selectResourceGroupToDelete', 'Select resource group(s) to delete'),
    });

    return {
        subscription,
        resourceGroupsToDelete: pickedResourceGroups.map(pick => createResourceGroup(subscription, pick.data)),
    };
}

async function deleteResourceGroups(context: IActionContext, subscription: AzureSubscription, resourceGroups: AzureResource[]): Promise<void> {
    const client = await createResourceClient([context, createSubscriptionContext(subscription)]);

    const deleteConfirmation: string | undefined = settingUtils.getWorkspaceSetting('deleteConfirmation');
    for await (const rg of resourceGroups) {

        const resourcesInRg = await uiUtils.listAllIterator(client.resources.listByResourceGroup(rg.name));
        const numOfResources = resourcesInRg.length;
        const hasOneResource: boolean = numOfResources === 1;

        if (deleteConfirmation === 'ClickButton') {
            const areYouSureDelete: string = localize('areYouSureDelete', 'Are you sure you want to delete resource group "{0}"? There are {1} resources in this resource group that will be deleted.', rg.name, numOfResources);
            const areYouSureDeleteOne: string = localize('areYouSureDeleteOne', 'Are you sure you want to delete resource group "{0}"? There is {1} resource in this resource group that will be deleted.', rg.name, numOfResources);
            await context.ui.showWarningMessage(hasOneResource ? areYouSureDeleteOne : areYouSureDelete, { modal: true }, { title: localize('delete', 'Delete') }); // no need to check result - cancel will throw error
        } else {
            const enterToDelete: string = localize('enterToDelete', 'Enter "{0}" to delete this resource group. There are {1} resources in this resource group that will be deleted.', rg.name, numOfResources);
            const enterToDeleteOne: string = localize('enterToDeleteOne', 'Enter "{0}" to delete this resource group. There is {1} resource in this resource group that will be deleted.', rg.name, numOfResources);
            const prompt = hasOneResource ? enterToDeleteOne : enterToDelete;
            function validateInput(val: string | undefined): string | undefined {
                return isNameEqual(val, rg.name) ? undefined : prompt;
            }
            const result: string = await context.ui.showInputBox({ prompt, validateInput });
            if (!isNameEqual(result, rg.name)) { // Check again just in case `validateInput` didn't prevent the input box from closing
                context.telemetry.properties.cancelStep = 'mismatchDelete';
                throw new UserCancelledError();
            }
        }

        void ext.azureTreeState.runWithTemporaryDescription(rg.id, localize('deleting', 'Deleting...'), async () => {
            const wizard = new AzureWizard<DeleteResourceGroupContext>({
                subscription: createSubscriptionContext(subscription),
                resourceGroupToDelete: rg.name,
                activityTitle: localize('deleteResourceGroup', 'Delete resource group "{0}"', rg.name),
                ...(await createActivityContext()),
                ...context,
            }, {
                executeSteps: [new DeleteResourceGroupStep()]
            });

            await wizard.execute();
            ext.azureTreeState.notifyChildrenChanged(`/subscriptions/${rg.subscription.subscriptionId}`);
        });
    }
}
