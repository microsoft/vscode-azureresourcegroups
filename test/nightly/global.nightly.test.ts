/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { longRunningTestsEnabled } from '../global.test';

export const resourceGroupsToDelete: string[] = [];

// Runs before all nightly tests
suiteSetup(async function (this: Mocha.Context): Promise<void> {
    if (longRunningTestsEnabled) {
        this.timeout(2 * 60 * 1000);

        // sign-in code stuff here?
    }
});

suiteTeardown(async function (this: Mocha.Context): Promise<void> {
    if (longRunningTestsEnabled) {
        this.timeout(10 * 60 * 1000);

        await deleteResourceGroups();
    }
});

async function deleteResourceGroups(): Promise<void> {
    // const rgClient: ResourceManagementClient = createAzureClient([await createTestActionContext(), testAccount.getSubscriptionContext()], ResourceManagementClient);
    // await Promise.all(resourceGroupsToDelete.map(async resourceGroup => {
    //     if ((await rgClient.resourceGroups.checkExistence(resourceGroup)).body) {
    //         console.log(`Started delete of resource group "${resourceGroup}"...`);
    //         await rgClient.resourceGroups.beginDeleteAndWait(resourceGroup);
    //         console.log(`Successfully started delete of resource group "${resourceGroup}".`);
    //     } else {
    //         // If the test failed, the resource group might not actually exist
    //         console.log(`Ignoring resource group "${resourceGroup}" because it does not exist.`);
    //     }
    // }));
}