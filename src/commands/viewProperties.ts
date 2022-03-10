/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, openReadOnlyJson } from '@microsoft/vscode-azext-utils';
import { ext } from '../extensionVariables';
import { AppResourceTreeItem } from '../tree/AppResourceTreeItem';
import { ResourceGroupTreeItem } from '../tree/ResourceGroupTreeItem';

export async function viewProperties(context: IActionContext, node?: ResourceGroupTreeItem | AppResourceTreeItem): Promise<void> {
    if (!node) {
        node = await ext.tree.showTreeItemPicker<ResourceGroupTreeItem>(ResourceGroupTreeItem.contextValue, context);
    }

    await openReadOnlyJson(node, node.data || {});
}
