/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { ResourceGroupTreeItem } from '../../tree/ResourceGroupTreeItem';
import { SubscriptionTreeItem } from '../../tree/SubscriptionTreeItem';
import { localize } from '../../utils/localize';
import { settingUtils } from '../../utils/settingUtils';

export async function deleteResourceGroup(context: IActionContext, primaryNode?: ResourceGroupTreeItem, selectedNodes?: ResourceGroupTreeItem[]): Promise<void> {
    if (!selectedNodes) {
        if (primaryNode) {
            selectedNodes = [primaryNode];
        } else {
            const subscription: SubscriptionTreeItem = await ext.appResourceTree.showTreeItemPicker(SubscriptionTreeItem.contextValue, context);
            selectedNodes = await subscription.pickResourceGroup(context, {
                canPickMany: true,
                placeholder: localize('selectResourceGroupToDelete', 'Select resource group(s) to delete'),
            });
        }
    } else {
        selectedNodes = selectedNodes.filter(n => n instanceof ResourceGroupTreeItem);
    }

    const deleteConfirmation: string | undefined = settingUtils.getWorkspaceSetting('deleteConfirmation');
    for (const node of selectedNodes) {
        const numOfResources = await node.getNumOfResources(context);
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

        void node.deleteTreeItem(context);
    }
}

function isNameEqual(val: string | undefined, node: ResourceGroupTreeItem): boolean {
    return !!val && val.toLowerCase() === node.name.toLowerCase();
}
