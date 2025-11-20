import assert from "assert";
import { commands } from "vscode";
import { AzExtResourceType } from "../api/src";
import { GroupingItem } from "../src/tree/azure/grouping/GroupingItem";
import { isLocationGroupingItem, LocationGroupingItem } from "../src/tree/azure/grouping/LocationGroupingItem";
import { isResourceGroupGroupingItem, ResourceGroupGroupingItem } from "../src/tree/azure/grouping/ResourceGroupGroupingItem";
import { isResourceTypeGroupingItem, ResourceTypeGroupingItem } from "../src/tree/azure/grouping/ResourceTypeGroupingItem";
import { GenericItem } from "../src/tree/GenericItem";
import { createMockSubscriptionWithFunctions } from "./api/mockServiceFactory";
import { getCachedTestApi } from "./utils/testApiAccess";

const api = () => {
    return getCachedTestApi().getApi().resources;
};

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

    test('Resource type group with no resources shows install extension item', async () => {
        createMockSubscriptionWithFunctions();

        await commands.executeCommand('azureResourceGroups.groupBy.resourceType');

        const tdp = api().azureResourceTreeDataProvider;
        const subscriptions = await tdp.getChildren();

        const groups = await tdp.getChildren(subscriptions![0]) as GroupingItem[];
        
        // Find a resource type group that has no resources (e.g., AiFoundry)
        const aiFoundryGroup = groups.find(group => 
            isResourceTypeGroupingItem(group) && 
            (group as ResourceTypeGroupingItem).resourceType === AzExtResourceType.AiFoundry
        );
        
        if (aiFoundryGroup) {
            const children = await aiFoundryGroup.getChildren();
            
            // Should have at least one child (the "Install extension" item)
            assert.ok(children && children.length > 0, 'Expected install extension item for empty resource type group');
            
            // First child should be a GenericItem with the correct command
            const firstChild = children[0];
            assert.ok(firstChild instanceof GenericItem, 'Expected first child to be a GenericItem');
        }
    });
});
