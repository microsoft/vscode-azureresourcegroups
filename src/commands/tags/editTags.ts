/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "vscode-azureextensionui";
import { ext } from "../../extensionVariables";
import { ResourceGroupTreeItem } from "../../tree/ResourceGroupTreeItem";

export async function editTags(context: IActionContext, node?: ResourceGroupTreeItem): Promise<void> {
    if (!node) {
        node = await ext.tree.showTreeItemPicker<ResourceGroupTreeItem>(ResourceGroupTreeItem.contextValue, context);
    }

    await ext.tagFS.showTextDocument(node);
}
