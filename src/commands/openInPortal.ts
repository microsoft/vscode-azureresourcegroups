/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { openInPortal as uiOpenInPortal } from '@microsoft/vscode-azext-azureutils';
import { IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../extensionVariables';
import { ResourceGroupTreeItem } from '../tree/ResourceGroupTreeItem';
import { ResourceTreeItem } from '../tree/ResourceTreeItem';

export async function openInPortal(context: IActionContext, node?: ResourceGroupTreeItem | ResourceTreeItem): Promise<void> {
    if (!node) {
        node = await ext.tree.showTreeItemPicker<ResourceGroupTreeItem>(ResourceGroupTreeItem.contextValue, context);
    }

    await uiOpenInPortal(node, node.fullId);
}
