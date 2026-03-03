/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "assert";
import { commands } from "vscode";
import { hasPortalUrl } from "../src/commands/openInPortal";
import { hasViewProperties } from "../src/commands/viewProperties";
import { GroupingItem } from "../src/tree/azure/grouping/GroupingItem";
import { ResourceGroupGroupingItem } from "../src/tree/azure/grouping/ResourceGroupGroupingItem";
import { createMockSubscriptionWithFunctions } from "./api/mockServiceFactory";
import { validateSubscription } from "./utils/validateSubscription";
import { getCachedTestApi } from "./utils/testApiAccess";

const api = () => {
    return getCachedTestApi().getApi().resources;
};

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
