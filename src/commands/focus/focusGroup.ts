/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from 'vscode';
import { ext } from "../../extensionVariables";
import { GroupingItem } from "../../tree/azure/GroupingItem";

export async function focusGroup(_context: IActionContext, item: GroupingItem): Promise<void> {
    if (item.resourceGroup) {
        ext.focusedGroup = {
            kind: 'resourceGroup',
            id: item.resourceGroup.id.toLowerCase(),
        }
    } else if (item.resourceType) {
        ext.focusedGroup = {
            kind: 'resourceType',
            type: item.resourceType,
        }
    } else if (item.location) {
        ext.focusedGroup = {
            kind: 'location',
            location: item.location,
        }
    }

    await vscode.commands.executeCommand('setContext', 'ms-azuretools.vscode-azureresourcegroups.hasFocusedGroup', true);
    ext.actions.refreshFocusTree();
    await ext.focusView.reveal(undefined);
}
