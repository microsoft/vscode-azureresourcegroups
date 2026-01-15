/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { contextValueExperience, IActionContext } from "@microsoft/vscode-azext-utils";
import { AzExtResourceType } from "api/src";
import * as vscode from 'vscode';
import { canFocusContextValue, hasFocusedGroupContextKey } from "../../constants";
import { ext } from "../../extensionVariables";
import { GroupingItem } from "../../tree/azure/grouping/GroupingItem";
import { isLocationGroupingItem } from "../../tree/azure/grouping/LocationGroupingItem";
import { isResourceGroupGroupingItem } from "../../tree/azure/grouping/ResourceGroupGroupingItem";
import { isResourceTypeGroupingItem } from "../../tree/azure/grouping/ResourceTypeGroupingItem";
import { validateResourceGroupId } from "../../utils/azureUtils";

export async function focusGroup(context: IActionContext, itemOrId?: GroupingItem | string): Promise<void> {
    if (typeof itemOrId === 'string') {
        // When called with a resource group ID string, validate it and set focus state directly
        // This works regardless of the current tree grouping mode
        context.errorHandling.rethrow = true;
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.suppressReportIssue = true;
        
        validateResourceGroupId(itemOrId);
        
        ext.focusedGroup = {
            kind: 'resourceGroup',
            id: itemOrId.toLowerCase(),
        };
        
        context.telemetry.properties.calledWithId = 'true';
        context.telemetry.properties.groupKind = 'resourceGroup';
        
        await vscode.commands.executeCommand('setContext', hasFocusedGroupContextKey, true);
        ext.actions.refreshFocusTree();
        await ext.focusView.reveal(undefined);
        return;
    }

    // When called with a tree item or no arguments, use the tree-based approach
    const item = itemOrId ?? await contextValueExperience<GroupingItem>(context, ext.v2.api.resources.azureResourceTreeDataProvider, {
        include: canFocusContextValue,
    });

    if (isResourceGroupGroupingItem(item)) {
        ext.focusedGroup = {
            kind: 'resourceGroup',
            id: item.resourceGroup.id.toLowerCase(),
        };
    } else if (isResourceTypeGroupingItem(item)) {
        ext.focusedGroup = {
            kind: 'resourceType',
            type: item.resourceType as AzExtResourceType,
        };
        context.telemetry.properties.resourceType = item.resourceType;
    } else if (isLocationGroupingItem(item)) {
        ext.focusedGroup = {
            kind: 'location',
            location: item.location,
        };
    }

    if (ext.focusedGroup) {
        context.telemetry.properties.groupKind = ext.focusedGroup?.kind;
    }

    await vscode.commands.executeCommand('setContext', hasFocusedGroupContextKey, true);
    ext.actions.refreshFocusTree();
    await ext.focusView.reveal(undefined);
}
