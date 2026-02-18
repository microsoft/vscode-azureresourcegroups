/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Location } from '@azure/arm-resources-subscriptions';
import { AzExtParentTreeItem, createTestActionContext, randomUtils, runWithTestActionContext } from '@microsoft/vscode-azext-utils';
import assert from "assert";
import * as vscode from 'vscode';
import { SubscriptionItem } from '../../src/tree/azure/SubscriptionItem';
import { settingUtils } from '../../src/utils/settingUtils';
import { longRunningTestsEnabled } from "../global.test";
import { setupAzureDevOpsSubscriptionProvider } from "../utils/azureDevOpsSubscriptionProvider";
import { getCachedTestApi } from "../utils/testApiAccess";

const useAzureFederatedCredentials: boolean = !/^(false|0)?$/i.test(process.env['AzCode_UseAzureFederatedCredentials'] || '');

let rgName: string;
let locations: Location[];
let testSubscription: SubscriptionItem;

suite('Resource CRUD Operations', function (this: Mocha.Suite): void {
    this.timeout(7 * 60 * 1000);

    suiteSetup(async function (this: Mocha.Context): Promise<void> {
        if (!longRunningTestsEnabled) {
            this.skip();
        }

        const testApi = getCachedTestApi();
        // Clear mock overrides that may have been set by other test suites
        testApi.testing.setOverrideAzureServiceFactory(undefined);
        testApi.testing.setOverrideAzureSubscriptionProvider(undefined);

        // Re-establish the AzDO federated credential provider if running in a pipeline,
        // since other test suites may have overwritten it with a mock provider.
        if (useAzureFederatedCredentials) {
            await setupAzureDevOpsSubscriptionProvider();
        }

        // Refresh the tree and wait for any pending tree operations to settle.
        // This avoids a race condition where a background tree refresh (triggered by
        // the logIn command in global.nightly.test.ts) cancels our getChildren() call
        // via the shared cancellation token in AzureResourceTreeDataProvider.
        await vscode.commands.executeCommand('azureResourceGroups.refresh');
        await new Promise(resolve => setTimeout(resolve, 2000));

        const subscriptionTreeItems = await testApi.compatibility.getAppResourceTree().getChildren() as unknown as SubscriptionItem[];

        // Filter to actual SubscriptionItems (exclude sign-in/placeholder items).
        const actualSubscriptions = subscriptionTreeItems.filter(
            (item): item is SubscriptionItem => !!(item as SubscriptionItem).subscription?.subscriptionId
        );

        // if we can't find any subscriptions, then something is wrong with the test setup (e.g. auth failure), so skip the tests rather than fail them
        if (actualSubscriptions.length === 0) {
            this.skip();
            return;
        }

        const testContext = await createTestActionContext();
        testSubscription = actualSubscriptions[0];

        const context = {
            ...testContext,
            ...testSubscription.subscription,
            environment: structuredClone(testSubscription.subscription.environment)
        };
        locations = (await testApi.testing.getLocations(context)).slice(0, 5); // limit to 5 locations for test speed

        rgName = randomUtils.getRandomHexString(12);
    });

    test('Create Resource Group (single)', async () => {
        await runWithTestActionContext('createResourceGroup', async context => {
            const testInputs: (string | RegExp)[] = [rgName, locations[0].displayName!];
            await context.ui.runWithInputs(testInputs, async () => {
                await getCachedTestApi().testing.createResourceGroup(context, testSubscription);
            });

            assert.ok(await getCachedTestApi().testing.resourceGroupExists(context, testSubscription, rgName));
        });
    });

    test('Create Resource Groups (all locations)', async () => {
        await Promise.all(locations.map(async l => {
            await runWithTestActionContext('createResourceGroup', async context => {
                const testInputs: (string | RegExp)[] = [`${rgName}-${l.name}`, l.displayName!];
                await context.ui.runWithInputs(testInputs, async () => {
                    await getCachedTestApi().testing.createResourceGroup(context, testSubscription);
                });

                assert.ok(await getCachedTestApi().testing.resourceGroupExists(context, testSubscription, `${rgName}-${l.name}`));
            });
        }));
    });

    test('Get Resources', async () => {
        const testApi = getCachedTestApi();
        const subscriptionTreeItems = await testApi.compatibility.getAppResourceTree().getChildren();
        assert.ok(subscriptionTreeItems.length > 0);
        for (const subscription of subscriptionTreeItems) {
            const groupTreeItems = await testApi.compatibility.getAppResourceTree().getChildren(subscription as AzExtParentTreeItem);
            await Promise.all(groupTreeItems.map(async g => {
                const children = await testApi.compatibility.getAppResourceTree().getChildren(g as AzExtParentTreeItem);
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
                    await getCachedTestApi().testing.deleteResourceGroupV2(context);
                } catch (_) {
                    console.debug('Expected error: ', _);
                    // expected to fail here
                }
                assert.ok(await getCachedTestApi().testing.resourceGroupExists(context, testSubscription, rgName));
            });
        });
    });

    test('Delete Resource (EnterName)', async () => {
        await settingUtils.updateGlobalSetting('deleteConfirmation', 'EnterName');
        await runWithTestActionContext('Delete Resource', async context => {
            await context.ui.runWithInputs([rgName, rgName], async () => {
                await getCachedTestApi().testing.deleteResourceGroupV2(context);
            });
        });
    });

    test('Delete Resource (ClickButton)', async () => {
        await settingUtils.updateGlobalSetting('deleteConfirmation', 'ClickButton');
        const deleteArray: string[] = Array(locations.length).fill('Delete');
        await runWithTestActionContext('Delete Resource', async context => {
            await context.ui.runWithInputs([new RegExp(`${rgName}-`), ...deleteArray], async () => {
                await getCachedTestApi().testing.deleteResourceGroupV2(context);
            });
        });

        assert.ok(true);
    });
});
