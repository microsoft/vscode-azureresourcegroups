/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, IActionContext, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { ResourceGroupTreeItem } from '../../../tree/ResourceGroupTreeItem';
import { localize } from '../../../utils/localize';
import { settingUtils } from '../../../utils/settingUtils';
import { GroupingItem } from '../../../tree/v2/GroupingItem';
import { DeleteResourceGroupContext } from '../DeleteResourceGroupContext';
import { DeleteResourceGroupStep } from '../DeleteResourceGroupStep';
import { createActivityContext } from '../../../utils/activityUtils';

export async function deleteResourceGroupV2(context: IActionContext, primaryNode?: GroupingItem, selectedNodes?: GroupingItem[]): Promise<void> {
    if (!selectedNodes) {
        if (primaryNode) {
            selectedNodes = [primaryNode];
        } else {
            selectedNodes = [];
            // TODO: Deal with picker.
            // const subscription: SubscriptionTreeItem = await ext.appResourceTree.showTreeItemPicker(SubscriptionTreeItem.contextValue, context);
            // selectedNodes = await subscription.pickResourceGroup(context, {
            //    canPickMany: true,
            //    placeholder: localize('selectResourceGroupToDelete', 'Select resource group(s) to delete'),
            //});
        }
    } else {
        selectedNodes = selectedNodes.filter(n => n instanceof ResourceGroupTreeItem);
    }

    const deleteConfirmation: string | undefined = settingUtils.getWorkspaceSetting('deleteConfirmation');
    for (const node of selectedNodes) {
        const numOfResources = node.resources.length;
        const hasOneResource: boolean = numOfResources === 1;

        if (deleteConfirmation === 'ClickButton') {
            const areYouSureDelete: string = localize('areYouSureDelete', 'Are you sure you want to delete resource group "{0}"? There are {1} resources in this resource group that will be deleted.', node.name, numOfResources);
            const areYouSureDeleteOne: string = localize('areYouSureDeleteOne', 'Are you sure you want to delete resource group "{0}"? There is {1} resource in this resource group that will be deleted.', node.name, numOfResources);
            await context.ui.showWarningMessage(hasOneResource ? areYouSureDeleteOne : areYouSureDelete, { modal: true }, { title: localize('delete', 'Delete') }); // no need to check result - cancel will throw error
        } else {
            const enterToDelete: string = localize('enterToDelete', 'Enter "{0}" to delete this resource group. There are {1} resources in this resource group that will be deleted.', node.name, numOfResources);
            const enterToDeleteOne: string = localize('enterToDeleteOne', 'Enter "{0}" to delete this resource group. There is {1} resource in this resource group that will be deleted.', node.name, numOfResources);
            const prompt = hasOneResource ? enterToDeleteOne : enterToDelete;
            function validateInput(val: string | undefined): string | undefined {
                return isNameEqual(val, node) ? undefined : prompt;
            }
            const result: string = await context.ui.showInputBox({ prompt, validateInput });
            if (!isNameEqual(result, node)) { // Check again just in case `validateInput` didn't prevent the input box from closing
                context.telemetry.properties.cancelStep = 'mismatchDelete';
                throw new UserCancelledError();
            }
        }

        void node.withDescription(
            'Deleting...',
            async () => {
                const wizard = new AzureWizard<DeleteResourceGroupContext>({
                    subscription: node.context.subscriptionContext,
                    resourceGroupToDelete: node.name,
                    activityTitle: localize('deleteResourceGroup', 'Delete resource group "{0}"', node.name),
                    ...(await createActivityContext()),
                    ...context,
                }, {
                    executeSteps: [new DeleteResourceGroupStep()]
                });

                await wizard.execute();
                    });
    }
}

function isNameEqual(val: string | undefined, node: GroupingItem): boolean {
    return !!val && val.toLowerCase() === node.name.toLowerCase();
}
