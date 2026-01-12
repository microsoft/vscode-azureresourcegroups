/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from 'vscode';
import { validateResourceGroupId } from "../../utils/azureUtils";

export async function testFocusResourceGroup(context: IActionContext): Promise<void> {
    const resourceGroupId = await vscode.window.showInputBox({
        prompt: 'Enter a resource group ID',
        placeHolder: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-resource-group',
        validateInput: (value) => {
            if (!value) {
                return 'Resource group ID is required';
            }
            try {
                validateResourceGroupId(value);
                return undefined;
            } catch (error) {
                return error instanceof Error ? error.message : 'Invalid resource group ID format';
            }
        }
    });

    if (!resourceGroupId) {
        return;
    }

    context.telemetry.properties.isTestCommand = 'true';

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Focusing on resource group...',
            cancellable: false
        },
        async () => {
            try {
                await vscode.commands.executeCommand('azureResourceGroups.focusGroup', resourceGroupId);
                void vscode.window.showInformationMessage(`Successfully focused on resource group: ${resourceGroupId}`);
            } catch (error) {
                void vscode.window.showErrorMessage(`Failed to focus on resource group: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );
}
