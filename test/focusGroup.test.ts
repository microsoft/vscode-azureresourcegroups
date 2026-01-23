/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "assert";
import { commands } from "vscode";
import { createMockSubscriptionWithFunctions } from "./api/mockServiceFactory";
import { getCachedTestApi } from "./utils/testApiAccess";

suite('focusGroup command tests', () => {
    test("focusGroup command should accept GroupingItem (backward compatibility)", async () => {
        createMockSubscriptionWithFunctions();
        
        // Group by resource group and populate tree
        await commands.executeCommand('azureResourceGroups.groupBy.resourceGroup');
        
        const tdp = getCachedTestApi().getApi().resources.azureResourceTreeDataProvider;
        const subscriptions = await tdp.getChildren();
        const resourceGroups = await tdp.getChildren(subscriptions![0]);
        
        assert.ok(resourceGroups && resourceGroups.length > 0, 'Should have resource groups');
        
        // Call the command with a GroupingItem (existing behavior)
        await commands.executeCommand('azureResourceGroups.focusGroup', resourceGroups[0]);
        
        // Verify that the focused group was set
        const focusedGroup = getCachedTestApi().extensionVariables.getFocusedGroup();
        assert.ok(focusedGroup, 'Focused group should be set');
        assert.strictEqual(focusedGroup.kind, 'resourceGroup', 'Focused group kind should be resourceGroup');
    });

    test("focusGroup command should accept string ID (new behavior)", async () => {
        const mockResources = createMockSubscriptionWithFunctions();
        const resourceGroupId = mockResources.sub1.rg1.id;
        
        // Set grouping mode and populate tree
        await commands.executeCommand('azureResourceGroups.groupBy.resourceGroup');
        const tdp = getCachedTestApi().getApi().resources.azureResourceTreeDataProvider;
        const subscriptions = await tdp.getChildren();
        await tdp.getChildren(subscriptions![0]);
        
        // Call the command with a string ID (new behavior)
        await commands.executeCommand('azureResourceGroups.focusGroup', resourceGroupId);
        
        // Verify that the focused group was set
        const focusedGroup = getCachedTestApi().extensionVariables.getFocusedGroup();
        assert.ok(focusedGroup, 'Focused group should be set');
        assert.strictEqual(focusedGroup.kind, 'resourceGroup', 'Focused group kind should be resourceGroup');
        if (focusedGroup && focusedGroup.kind === 'resourceGroup') {
            assert.strictEqual(focusedGroup.id, resourceGroupId.toLowerCase(), 'Focused group ID should match');
        }
    });

    test("focusGroup command should clear previous focus when focusing new group", async () => {
        const mockResources = createMockSubscriptionWithFunctions();
        const resourceGroupId = mockResources.sub1.rg1.id;
        
        // Set grouping mode and populate tree
        await commands.executeCommand('azureResourceGroups.groupBy.resourceGroup');
        const tdp = getCachedTestApi().getApi().resources.azureResourceTreeDataProvider;
        const subscriptions = await tdp.getChildren();
        await tdp.getChildren(subscriptions![0]);
        
        // Set initial focus
        await commands.executeCommand('azureResourceGroups.focusGroup', resourceGroupId);
        let focusedGroup = getCachedTestApi().extensionVariables.getFocusedGroup();
        assert.ok(focusedGroup, 'Focused group should be set initially');
        
        // Focus on a different group
        const rg2Id = `${mockResources.sub1.id}/resourceGroups/test-rg-2`;
        mockResources.sub1.resourceGroups.push({
            type: 'microsoft.resources/resourcegroups',
            name: 'test-rg-2',
            location: 'eastus',
            id: rg2Id,
            resources: []
        } as any);
        
        // Refresh tree to include the new resource group
        await commands.executeCommand('azureResourceGroups.refreshTree');
        await tdp.getChildren();
        await tdp.getChildren(subscriptions![0]);
        
        await commands.executeCommand('azureResourceGroups.focusGroup', rg2Id);
        
        // Verify the focus changed
        focusedGroup = getCachedTestApi().extensionVariables.getFocusedGroup();
        assert.ok(focusedGroup, 'Focused group should still be set');
        if (focusedGroup && focusedGroup.kind === 'resourceGroup') {
            assert.strictEqual(focusedGroup.id, rg2Id.toLowerCase(), 'Focused group should be the new group');
        }
    });
});
