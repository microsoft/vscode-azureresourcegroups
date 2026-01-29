/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "assert";
import { commands } from "vscode";
import { createMockSubscriptionWithFunctions } from "./api/mockServiceFactory";
import { getCachedTestApi } from "./utils/testApiAccess";
import { ext } from "../src/extensionVariables.js";

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

    test("focusGroup should handle same-named resource groups in different subscriptions", async () => {
        const mockResources = createMockSubscriptionWithFunctions();
        
        // Get all subscriptions and ensure we have at least 2
        const subscriptions = mockResources.subscriptions;
        assert.ok(subscriptions.length >= 2, 'Should have at least 2 subscriptions');
        
        // Use sub1 (MockSubscriptionWithFunctions) and the second subscription
        const sub1 = mockResources.sub1;
        const sub2 = subscriptions.find(s => s.subscriptionId !== sub1.subscriptionId);
        assert.ok(sub2, 'Second subscription should exist');
        
        // Create a resource group with the same name in both subscriptions
        const rgName = 'duplicate-rg-name';
        const rg1Id = `${sub1.id}/resourceGroups/${rgName}`;
        const rg2Id = `${sub2.id}/resourceGroups/${rgName}`;
        
        // Add resource groups to both subscriptions with resources
        sub1.resourceGroups.push({
            type: 'microsoft.resources/resourcegroups',
            name: rgName,
            location: 'eastus',
            id: rg1Id,
            resources: [
                {
                    name: 'test-function-sub1',
                    type: 'microsoft.web/sites',
                    kind: 'functionapp',
                    id: `${rg1Id}/providers/microsoft.web/sites/test-function-sub1`
                } as any
            ]
        } as any);
        
        sub2.resourceGroups.push({
            type: 'microsoft.resources/resourcegroups',
            name: rgName,
            location: 'westus',
            id: rg2Id,
            resources: [
                {
                    name: 'test-function-sub2',
                    type: 'microsoft.web/sites',
                    kind: 'functionapp',
                    id: `${rg2Id}/providers/microsoft.web/sites/test-function-sub2`
                } as any
            ]
        } as any);
        
        // Set grouping mode and populate tree
        await commands.executeCommand('azureResourceGroups.groupBy.resourceGroup');
        const tdp = getCachedTestApi().getApi().resources.azureResourceTreeDataProvider;
        await tdp.getChildren();
        
        // Focus on the first resource group
        await commands.executeCommand('azureResourceGroups.focusGroup', rg1Id);
        let focusedGroup = getCachedTestApi().extensionVariables.getFocusedGroup();
        assert.ok(focusedGroup, 'Focused group should be set for first RG');
        assert.strictEqual(focusedGroup.kind, 'resourceGroup', 'Focused group kind should be resourceGroup');
        if (focusedGroup && focusedGroup.kind === 'resourceGroup') {
            assert.strictEqual(focusedGroup.id, rg1Id.toLowerCase(), 'Focused group ID should match first RG');
        }
        
        // Get the focused tree items
        const focusedItems1 = await ext.focusViewTreeDataProvider.getChildren();
        assert.ok(focusedItems1 && focusedItems1.length > 0, 'Focused items should not be empty after focusing first RG');
        
        // Focus on the second resource group with the same name but different subscription
        await commands.executeCommand('azureResourceGroups.focusGroup', rg2Id);
        focusedGroup = getCachedTestApi().extensionVariables.getFocusedGroup();
        assert.ok(focusedGroup, 'Focused group should be set for second RG');
        assert.strictEqual(focusedGroup.kind, 'resourceGroup', 'Focused group kind should be resourceGroup');
        if (focusedGroup && focusedGroup.kind === 'resourceGroup') {
            assert.strictEqual(focusedGroup.id, rg2Id.toLowerCase(), 'Focused group ID should match second RG');
        }
        
        // Verify that the focused list is not empty
        const focusedItems2 = await ext.focusViewTreeDataProvider.getChildren();
        assert.ok(focusedItems2 && focusedItems2.length > 0, 'Focused items should not be empty after focusing second RG with same name');
    });
});
