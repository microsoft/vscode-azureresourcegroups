/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { appResourceExperience, IActionContext, openReadOnlyJson } from '@microsoft/vscode-azext-utils';
import { ext } from '../extensionVariables';
import { BuiltInApplicationResourceItem } from '../tree/v2/providers/BuiltInApplicationResourceItem';

export async function viewProperties(context: IActionContext, node?: BuiltInApplicationResourceItem): Promise<void> {
    if (!node) {
        node = await appResourceExperience<BuiltInApplicationResourceItem>(context, ext.v2.resourceGroupsTreeDataProvider);
    }

    await openReadOnlyJson({ fullId: node.azureResourceId, label: node.name }, node.data);
}
