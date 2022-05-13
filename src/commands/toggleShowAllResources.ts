/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from '@microsoft/vscode-azext-utils';
import { GroupTreeItemBase } from '../tree/GroupTreeItemBase';

export async function toggleShowAllResources(context: IActionContext, node: GroupTreeItemBase): Promise<void> {
    await node.toggleShowAllResources(context);
}
