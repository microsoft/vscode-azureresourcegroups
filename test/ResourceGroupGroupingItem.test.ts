import { commands } from "vscode";
import { ext, GroupingItem, hasPortalUrl, hasViewProperties, ResourceGroupGroupingItem } from "../extension.bundle";
import { createMockSubscriptionWithFunctions } from "./api/mockServiceFactory";
import { validateSubscription } from "./utils/validateSubscription";
import assert = require("assert");

const api = () => {
    return ext.v2.api.resources;
}

suite('ResourceGroupGroupingItem', async () => {
    test('Validate element', async () => {
        const mocks = createMockSubscriptionWithFunctions();

        await commands.executeCommand('azureResourceGroups.groupBy.resourceGroup');

        const tdp = api().azureResourceTreeDataProvider;
        const subscriptions = await tdp.getChildren();

        const groups = await tdp.getChildren(subscriptions![0]) as GroupingItem[];
        const resourceGroup = groups.find(group => (group as ResourceGroupGroupingItem).resourceGroup.id === mocks.sub1.rg1.id);
        assert.ok(resourceGroup);
        assert.ok(hasViewProperties(resourceGroup), 'ResourceGroupGroupingItem should have viewable properties');
        assert.ok(hasPortalUrl(resourceGroup), 'ResourceGroupGroupingItem should have a portal URL');
        assert.ok(resourceGroup.subscription, 'ResourceGroupGroupingItem should have a subscription');
        validateSubscription(resourceGroup.subscription);
    });
});
