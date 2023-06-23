import { commands } from "vscode";
import { AzExtResourceType, ext, GroupingItem, isLocationGroupingItem, isResourceGroupGroupingItem, isResourceTypeGroupingItem, LocationGroupingItem, ResourceGroupGroupingItem, ResourceTypeGroupingItem } from "../extension.bundle";
import { createMockSubscriptionWithFunctions } from "./api/mockServiceFactory";
import assert = require("assert");

const api = () => {
    return ext.v2.api.resources;
}

suite('Azure resource grouping tests', async () => {
    test('Group by resource type', async () => {
        createMockSubscriptionWithFunctions();

        await commands.executeCommand('azureResourceGroups.groupBy.resourceType');

        const tdp = api().azureResourceTreeDataProvider;
        const subscriptions = await tdp.getChildren();

        const groups = await tdp.getChildren(subscriptions![0]) as GroupingItem[];
        assert.ok(isResourceTypeGroupingItem(groups[0]));
        const functionGroup = groups.find(group => (group as ResourceTypeGroupingItem).resourceType === AzExtResourceType.FunctionApp);
        assert.ok(functionGroup);
    });

    test('Group by resource group', async () => {
        const mocks = createMockSubscriptionWithFunctions();

        await commands.executeCommand('azureResourceGroups.groupBy.resourceGroup');

        const tdp = api().azureResourceTreeDataProvider;
        const subscriptions = await tdp.getChildren();

        const groups = await tdp.getChildren(subscriptions![0]) as GroupingItem[];
        assert.ok(isResourceGroupGroupingItem(groups[0]));
        const resourceGroup = groups.find(group => (group as ResourceGroupGroupingItem).resourceGroup.id === mocks.sub1.rg1.id);
        assert.ok(resourceGroup);
    });

    test('Group by location', async () => {
        const mocks = createMockSubscriptionWithFunctions();

        await commands.executeCommand('azureResourceGroups.groupBy.location');

        const tdp = api().azureResourceTreeDataProvider;
        const subscriptions = await tdp.getChildren();

        const groups = await tdp.getChildren(subscriptions![0]) as GroupingItem[];
        assert.ok(isLocationGroupingItem(groups[0]));
        const locationGroup = groups.find(group => (group as LocationGroupingItem).location === mocks.sub1.rg1.location);
        assert.ok(locationGroup);
    });
});
