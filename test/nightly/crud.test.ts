/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Location } from '@azure/arm-resources-subscriptions';
import { createTestActionContext, runWithTestActionContext } from '@microsoft/vscode-azext-dev';
import { AzExtParentTreeItem, IActionContext, LocationListStep, SubscriptionItem, createResourceClient, createResourceGroup, deleteResourceGroupV2, ext, randomUtils, settingUtils } from '../../extension.bundle';
import { longRunningTestsEnabled } from "../global.test";
import assert = require("assert");

let rgName: string;
let locations: Location[];
let testSubscription: SubscriptionItem;

suite('Resource CRUD Operations', function (this: Mocha.Suite): void {
    this.timeout(7 * 60 * 1000);

    suiteSetup(async function (this: Mocha.Context): Promise<void> {
        if (!longRunningTestsEnabled) {
            this.skip();
        }

        ext.testing.overrideAzureServiceFactory = undefined;
        ext.testing.overrideAzureSubscriptionProvider = undefined;

        const subscriptionTreeItems = await ext.appResourceTree.getChildren() as unknown as SubscriptionItem[];
        if (subscriptionTreeItems.length > 0) {
            const testContext = await createTestActionContext();
            testSubscription = subscriptionTreeItems[0] as SubscriptionItem;
            const context = { ...testContext, ...testSubscription.subscription };
            locations = await LocationListStep.getLocations(context);
        }

        rgName = randomUtils.getRandomHexString(12);
    });

    test('Create Resource Group (single)', async () => {
        await runWithTestActionContext('createResourceGroup', async context => {
            const testInputs: (string | RegExp)[] = [rgName, locations[0].displayName!];
            await context.ui.runWithInputs(testInputs, async () => {
                await createResourceGroup(context, testSubscription);
            });

            assert.ok(await resourceGroupExists(context, rgName));
        });
    });

    test('Create Resource Groups (all locations)', async () => {
        await Promise.all(locations.map(async l => {
            await runWithTestActionContext('createResourceGroup', async context => {
                const testInputs: (string | RegExp)[] = [`${rgName}-${l.name}`, l.displayName!];
                await context.ui.runWithInputs(testInputs, async () => {
                    await createResourceGroup(context, testSubscription);
                });

                assert.ok(await resourceGroupExists(context, `${rgName}-${l.name}`));
            });
        }));
    });

    test('Get Resources', async () => {
        const subscriptionTreeItems = await ext.appResourceTree.getChildren();
        assert.ok(subscriptionTreeItems.length > 0);
        for (const subscription of subscriptionTreeItems) {
            const groupTreeItems = await ext.appResourceTree.getChildren(subscription as AzExtParentTreeItem);
            await Promise.all(groupTreeItems.map(async g => {
                const children = await ext.appResourceTree.getChildren(g as AzExtParentTreeItem);
                console.log(children);
            }));
        }

        assert.ok(true);
    });

    test('Delete Resource (EnterName) - Fails when invalid', async () => {
        await settingUtils.updateGlobalSetting('deleteConfirmation', 'EnterName');
        await runWithTestActionContext('Delete Resource', async context => {
            await context.ui.runWithInputs([rgName, 'rgName'], async () => {
                try {
                    await deleteResourceGroupV2(context);
                } catch (_) {
                    console.debug('Expected error: ', _);
                    // expected to fail here
                }
                assert.ok(await resourceGroupExists(context, rgName));
            });
        });
    });

    test('Delete Resource (EnterName)', async () => {
        await settingUtils.updateGlobalSetting('deleteConfirmation', 'EnterName');
        await runWithTestActionContext('Delete Resource', async context => {
            await context.ui.runWithInputs([rgName, rgName], async () => {
                await deleteResourceGroupV2(context);
            });
        });

    });

    test('Delete Resource (ClickButton)', async () => {
        await settingUtils.updateGlobalSetting('deleteConfirmation', 'ClickButton');
        const deleteArray: string[] = Array(locations.length).fill('Delete');
        await runWithTestActionContext('Delete Resource', async context => {
            await context.ui.runWithInputs([new RegExp(`${rgName}-`), ...deleteArray], async () => {
                await deleteResourceGroupV2(context);
            });
        });

        assert.ok(true);
    });
});

async function resourceGroupExists(context: IActionContext, rgName: string): Promise<boolean> {
    const client = await createResourceClient([context, testSubscription.subscription]);
    try {
        await client.resourceGroups.get(rgName);
        return true;
    } catch (_) {
        return false;
    }
}
