/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, ext } from '../../extension.bundle';
import { longRunningTestsEnabled } from "../global.test";
import assert = require("assert");

suite('Resource CRUD Operations', function (this: Mocha.Suite): void {
    this.timeout(7 * 60 * 1000);

    suiteSetup(async function (this: Mocha.Context): Promise<void> {
        if (!longRunningTestsEnabled) {
            this.skip();
        }
    });

    test('List Resources', async () => {
        console.log(await ext.appResourceTree.getChildren());
        const subscriptionTreeItems = await ext.appResourceTree.getChildren();
        assert.ok(subscriptionTreeItems.length > 0);
        for (const subscription of subscriptionTreeItems) {
            const resources = await ext.appResourceTree.getChildren(subscription as AzExtParentTreeItem);
            for (const resource of resources) {
                console.log(resource.id);
            }
        }
        assert.ok(true);
    });
});
