/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { contextValueExperience, IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from 'vscode';
import { canFocusContextValue, hasFocusedGroupContextKey } from "../../constants";
import { ext } from "../../extensionVariables";
import { GroupingItem } from "../../tree/azure/GroupingItem";

export async function focusGroup(context: IActionContext, item?: GroupingItem): Promise<void> {
    item ??= await contextValueExperience<GroupingItem>(context, ext.v2.api.resources.azureResourceTreeDataProvider, {
        include: canFocusContextValue,
    });

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

    if (ext.focusedGroup) {
        context.telemetry.properties.groupKind = ext.focusedGroup?.kind;
        if (ext.focusedGroup.kind === 'resourceType') {
            context.telemetry.properties.resourceType = ext.focusedGroup.type;
        }
    }

    await vscode.commands.executeCommand('setContext', hasFocusedGroupContextKey, true);
    ext.actions.refreshFocusTree();
    await ext.focusView.reveal(undefined);
}
