/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";

export interface GetAzureActivityLogContext extends IActionContext {
    /**
     * The id of the activity log tree item that was selected by the user.
     * This id is considered optional as the user is not always required to select a tree item.
     */
    selectedTreeItemId?: string;

    /**
     * Specifies which `callbackId` (or command id) the selected tree item is associated with.
     */
    selectedTreeItemCallbackId?: string;

    /**
     * Boolean value confirming that a `selectedTreeItemId` was both provided and found for the tree data set.
     */
    hasSelectedTreeItem?: boolean;

    /**
     * Boolean value indicating whether the selected tree item was an activity child item
     */
    isSelectedTreeItemChild?: boolean;
}
