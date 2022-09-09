/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, openReadOnlyJson } from '@microsoft/vscode-azext-utils';
import { BuiltInApplicationResourceItem } from '../tree/v2/providers/BuiltInApplicationResourceItem';

export async function viewProperties(context: IActionContext, node?: BuiltInApplicationResourceItem): Promise<void> {
    // TODO
    // if (!node) {
    //     node = await pickAppResource<AppResourceTreeItem>(context);
    // }

    if (node) {
        await openReadOnlyJson({ fullId: node.id, label: node.name }, node.data);
    }
}
