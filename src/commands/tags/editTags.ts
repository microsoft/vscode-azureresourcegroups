/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ext } from "../../extensionVariables";
import { ResourceGroupTreeItem } from "../../tree/ResourceGroupTreeItem";
import { ResourceTreeItem } from "../../tree/ResourceTreeItem";

export async function editTags(context: IActionContext, node?: ResourceGroupTreeItem | ResourceTreeItem): Promise<void> {
    if (!node) {
        node = await ext.tree.showTreeItemPicker<ResourceGroupTreeItem>(ResourceGroupTreeItem.contextValue, context);
    }

    await ext.tagFS.showTextDocument(node);
}
