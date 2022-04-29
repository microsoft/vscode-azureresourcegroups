/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceGroup } from '@azure/arm-resources';
import { openInPortal as uiOpenInPortal } from '@microsoft/vscode-azext-azureutils';
import { AzExtTreeItem, IActionContext, nonNullProp } from '@microsoft/vscode-azext-utils';
import { AppResource } from '@microsoft/vscode-azext-utils/hostapi';
import { pickAppResource } from '../api/pickAppResource';
import { AppResourceTreeItem } from '../tree/AppResourceTreeItem';
import { ResourceGroupTreeItem } from '../tree/ResourceGroupTreeItem';

export async function getDataFromNode(node: ResourceGroupTreeItem | AppResourceTreeItem): Promise<AppResource | ResourceGroup | undefined> {
    if (node instanceof ResourceGroupTreeItem) {
        return (await node.getData());
    }
    return node.data;
}

export async function openInPortal(context: IActionContext, node?: AzExtTreeItem): Promise<void> {


    if (!node) {
        node = await pickAppResource(context) as AppResourceTreeItem;
        // node = await ext.appResourceTree.showTreeItemPicker<ResourceGroupTreeItem>(ResourceGroupTreeItem.contextValue, context);
    }

    await uiOpenInPortal(node, nonNullProp(node, 'id'));
}
