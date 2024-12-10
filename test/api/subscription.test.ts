import * as vscode from 'vscode';
import { hasPortalUrl } from '../../extension.bundle';
import { validateSubscription } from '../utils/validateSubscription';
import { api } from "./api";
import { AzureResourceTreeDataProvider } from "./azureResourceBranchDataProvider.test";
import { createMockSubscriptionWithFunctions } from "./mockServiceFactory";
import assert = require("assert");

async function mockResourcesAndGetSubscriptionItems() {
    const mockResources = createMockSubscriptionWithFunctions();
    await vscode.commands.executeCommand('azureResourceGroups.groupBy.resourceGroup');

    const tdp = api().azureResourceTreeDataProvider as AzureResourceTreeDataProvider;
    const subscriptionItems = await tdp.getChildren();
    return { mockResources, subscriptionItems };
}

suite('SubscriptionItem tests', async () => {
    test('Tree should show a subscription item for each Azure subscription', async () => {
        const { mockResources, subscriptionItems } = await mockResourcesAndGetSubscriptionItems();
        mockResources.subscriptions.forEach((subscription) => {
            assert.ok(
                subscriptionItems?.find((node) => node.subscription.subscriptionId === subscription.subscriptionId),
                `Subscription ${subscription.id} not found in the tree. Found: ${subscriptionItems.map((node) => node.subscription.subscriptionId).join(', ')}`
            );
        });

        assert.strictEqual(subscriptionItems.length, mockResources.subscriptions.length, `There should be ${mockResources.subscriptions.length} subscription nodes. Found ${subscriptionItems.length}.`);
    });

    test('SubscriptionItem.id should be in the "/accounts/<account id>/tenants/<tenant id>/subscriptions/<subscription id>" format', async () => {
        const { subscriptionItems } = await mockResourcesAndGetSubscriptionItems();
        subscriptionItems.forEach((subscriptionItem) => {
            assert.match(subscriptionItem.id, /^\/accounts\/[^/]+\/tenants\/[^/]+\/subscriptions\/([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})/i);
        });
    });

    test('SubscriptionItem should have a portal url', async () => {
        const { subscriptionItems } = await mockResourcesAndGetSubscriptionItems();
        subscriptionItems.forEach((subscriptionItem) => {
            assert.ok(hasPortalUrl(subscriptionItem));
        });
    });

    /**
     * The subscription property is used by clients when passed to the Create Resource... command
     */
    test('SubscriptionItem.subscription satisfies ISubscriptionContext for v1.5 compatibility', async () => {
        const { subscriptionItems } = await mockResourcesAndGetSubscriptionItems();
        subscriptionItems.forEach((subscriptionItem) => {
            validateSubscription(subscriptionItem.subscription);
        });
    });
});
