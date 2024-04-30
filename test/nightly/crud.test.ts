/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DefaultAzureResourceProvider, ext } from '../../extension.bundle';
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
        const subscriptions = (await ext.subscriptionProviderFactory()).getSubscriptions(false);
        const provider = new DefaultAzureResourceProvider();
        for (const subscription of await subscriptions) {
            const resources = await provider.getResources(subscription);
            console.log(resources);
        }

        assert.ok(true);
    });
});
