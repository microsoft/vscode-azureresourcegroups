/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { IActionContext } from '@microsoft/vscode-azext-utils';
import { Memento } from 'vscode';
import { ext } from '../../extensionVariables';
import { ResourceGroupsItem } from '../../tree/v2/ResourceGroupsItem';
import { settingUtils } from '../../utils/settingUtils';

export async function pinTreeItem(_context: IActionContext, treeItem: ResourceGroupsItem): Promise<void> {
    const memento = getPersistenceMemento();
    const pinnedItems = memento.get<string[]>('pinnedTreeItems', []);

    pinnedItems.push(treeItem.id); // TODO: need an ID field

    await memento.update('pinnedTreeItems', pinnedItems);
}

export async function unpinTreeItem(_context: IActionContext, treeItem: ResourceGroupsItem): Promise<void> {
    const memento = getPersistenceMemento();
    const pinnedItems = memento.get<string[]>('pinnedTreeItems', []);

    const index = pinnedItems.indexOf(treeItem.id); // TODO: need an ID field
    if (index >= 0) {
        pinnedItems.splice(index, 1);
    }

    await memento.update('pinnedTreeItems', pinnedItems);
}

export function isPinned(treeItem: ResourceGroupsItem): boolean {
    const memento = getPersistenceMemento();
    const pinnedItems = memento.get<string[]>('pinnedTreeItems', []);

    return pinnedItems.includes(treeItem.id); // TODO: need an ID field
}

function getPersistenceMemento(): Memento {
    const persistenceMementoSetting = settingUtils.getWorkspaceSetting<'workspace' | 'global'>('pinPersistence');
    return persistenceMementoSetting === 'workspace' ? ext.context.workspaceState : ext.context.globalState;
}
