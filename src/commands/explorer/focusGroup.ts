/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ext } from "../../extensionVariables";
import { GroupTreeItemBase } from "../../tree/GroupTreeItemBase";

export async function focusGroup(_context: IActionContext, node?: GroupTreeItemBase): Promise<void> {
    if (!node) {
        node = await ext.appResourceTree.showTreeItemPicker<GroupTreeItemBase>(new RegExp(GroupTreeItemBase.contextValue), _context);
    }

    const id = node.config.id;
    // don't wait
    void ext.appResourceTreeView.reveal(node, { expand: true });
    await ext.context.workspaceState.update('focusedGroup', id);
    ext.emitters.onDidChangeFocusedGroup.fire();
}
