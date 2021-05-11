/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { window } from 'vscode';
import { IActionContext, UserCancelledError } from 'vscode-azureextensionui';
import { ext } from '../extensionVariables';
import { ResourceGroupTreeItem } from '../tree/ResourceGroupTreeItem';
import { localize } from '../utils/localize';
import { settingUtils } from '../utils/settingUtils';

export async function deleteResourceGroup(context: IActionContext, primaryNode?: ResourceGroupTreeItem, selectedNodes?: ResourceGroupTreeItem[]): Promise<void> {
    if (!selectedNodes) {
        if (primaryNode) {
            selectedNodes = [primaryNode];
        } else {
            selectedNodes = await ext.tree.showTreeItemPicker<ResourceGroupTreeItem>(ResourceGroupTreeItem.contextValue, { ...context, canPickMany: true, suppressCreatePick: true });
        }
    } else {
        selectedNodes = selectedNodes.filter(n => n instanceof ResourceGroupTreeItem);
    }

    const deleteConfirmation: string | undefined = settingUtils.getWorkspaceSetting('deleteConfirmation');
    for (const node of selectedNodes) {
        const numOfResources = await node.getNumOfResources(context);

        if (deleteConfirmation === 'ClickButton') {
            const areYouSureDelete: string = localize('areYouSureDelete', 'Are you sure you want to delete resource group "{0}"? There are {1} resources in this resource group that will be deleted.', node.name, numOfResources);
            await context.ui.showWarningMessage(areYouSureDelete, { modal: true }, { title: localize('delete', 'Delete') }); // no need to check result - cancel will throw error
        } else {
            const enterToDelete: string = localize('enterToDelete', 'Enter "{0}" to delete this resource group. There are {1} resources in this resource group that will be deleted.', node.name, numOfResources);
            function validateInput(val: string | undefined): string | undefined {
                return isNameEqual(val, node) ? undefined : enterToDelete;
            }
            const result: string = await context.ui.showInputBox({ prompt: enterToDelete, validateInput });
            if (!isNameEqual(result, node)) { // Check again just in case `validateInput` didn't prevent the input box from closing
                context.telemetry.properties.cancelStep = 'mismatchDelete';
                throw new UserCancelledError();
            }
        }

        void node.deleteTreeItem(context);
        const message: string = localize('startedDelete', 'Started delete of resource group "{0}".', node.name);
        void window.showInformationMessage(message);
        ext.outputChannel.appendLog(message);
    }
}

function isNameEqual(val: string | undefined, node: ResourceGroupTreeItem): boolean {
    return !!val && val.toLowerCase() === node.name.toLowerCase();
}
