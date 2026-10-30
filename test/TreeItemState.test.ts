/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import { GenericItem } from '../src/tree/GenericItem';
import { TreeItemStateStore } from '../src/tree/TreeItemState';

suite('TreeItemStateStore', () => {
    test('preserves placeholders for overlapping creations', async () => {
        const store = new TreeItemStateStore();
        const parent = store.wrapItemInStateHandling(new GenericItem('parent', { children: [] }), () => undefined);
        let finishFirst: () => void;
        let finishSecond: () => void;

        const firstCreate = store.showCreatingChild(parent.id!, 'first', () => new Promise<void>(resolve => finishFirst = resolve));
        const secondCreate = store.showCreatingChild(parent.id!, 'second', () => new Promise<void>(resolve => finishSecond = resolve));

        deepStrictEqual((await parent.getChildren!())?.map(child => child.id), [
            'parent/creating/0',
            'parent/creating/1',
        ]);

        finishFirst!();
        await firstCreate;
        deepStrictEqual((await parent.getChildren!())?.map(child => child.id), ['parent/creating/1']);

        finishSecond!();
        await secondCreate;
        deepStrictEqual(await parent.getChildren!(), []);
        store.dispose();
    });
});
