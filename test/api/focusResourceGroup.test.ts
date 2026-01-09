/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "assert";
import { commands } from "vscode";
import { getCachedTestApi } from "../utils/testApiAccess";
import { createMockSubscriptionWithFunctions } from "./mockServiceFactory";

const api = () => {
    return getCachedTestApi().getApi().resources;
};

suite('focusResourceGroup API tests', () => {
    test("focusResourceGroup should focus on a resource group by ID", async () => {
        const mockResources = createMockSubscriptionWithFunctions();
        const resourceGroupId = mockResources.sub1.rg1.id;

        // Set grouping mode and populate tree
        await commands.executeCommand('azureResourceGroups.groupBy.resourceGroup');
        const tdp = api().azureResourceTreeDataProvider;
        const subscriptions = await tdp.getChildren();
        await tdp.getChildren(subscriptions![0]);

        // Call the API method
        await api().focusResourceGroup(resourceGroupId);

        // Verify that the focused group was set correctly
        const focusedGroup = getCachedTestApi().extensionVariables.getFocusedGroup();
        assert.ok(focusedGroup, 'Focused group should be set');
        assert.strictEqual(focusedGroup.kind, 'resourceGroup', 'Focused group kind should be resourceGroup');
        if (focusedGroup && focusedGroup.kind === 'resourceGroup') {
            assert.strictEqual(focusedGroup.id, resourceGroupId.toLowerCase(), 'Focused group ID should match the resource group ID');
        }
    });

    test("focusResourceGroup command should accept resource group ID string", async () => {
        const mockResources = createMockSubscriptionWithFunctions();
        const resourceGroupId = mockResources.sub1.rg1.id;

        // Set grouping mode and populate tree
        await commands.executeCommand('azureResourceGroups.groupBy.resourceGroup');
        const tdp = api().azureResourceTreeDataProvider;
        const subscriptions = await tdp.getChildren();
        await tdp.getChildren(subscriptions![0]);

        // Call the command directly with a string ID
        await commands.executeCommand('azureResourceGroups.focusGroup', resourceGroupId);

        // Verify that the focused group was set correctly
        const focusedGroup = getCachedTestApi().extensionVariables.getFocusedGroup();
        assert.ok(focusedGroup, 'Focused group should be set');
        assert.strictEqual(focusedGroup.kind, 'resourceGroup', 'Focused group kind should be resourceGroup');
        if (focusedGroup.kind === 'resourceGroup') {
            assert.strictEqual(focusedGroup.id, resourceGroupId.toLowerCase(), 'Focused group ID should match the resource group ID');
        }
    });

    test("focusResourceGroup should be callable multiple times with different resource groups", async () => {
        const mockResources = createMockSubscriptionWithFunctions();

        // Set grouping mode and populate tree
        await commands.executeCommand('azureResourceGroups.groupBy.resourceGroup');
        const tdp = api().azureResourceTreeDataProvider;
        const subscriptions = await tdp.getChildren();
        await tdp.getChildren(subscriptions![0]);

        // Add another resource group
        const rg2Id = `${mockResources.sub1.id}/resourceGroups/test-rg-2`;
        mockResources.sub1.resourceGroups.push({
            type: 'microsoft.resources/resourcegroups',
            name: 'test-rg-2',
            location: 'eastus',
            id: rg2Id,
            resources: []
        } as any);

        const rg1Id = mockResources.sub1.rg1.id;

        // Focus on first resource group
        await api().focusResourceGroup(rg1Id);
        let focusedGroup = getCachedTestApi().extensionVariables.getFocusedGroup();
        assert.ok(focusedGroup, 'Focused group should be set');
        if (focusedGroup && focusedGroup.kind === 'resourceGroup') {
            assert.strictEqual(focusedGroup.id, rg1Id.toLowerCase(), 'First focused group ID should match');
        }

        // Refresh tree to include the new resource group
        await commands.executeCommand('azureResourceGroups.refreshTree');
        await tdp.getChildren();
        await tdp.getChildren(subscriptions![0]);

        // Focus on second resource group
        await api().focusResourceGroup(rg2Id);
        focusedGroup = getCachedTestApi().extensionVariables.getFocusedGroup();
        assert.ok(focusedGroup, 'Focused group should still be set');
        if (focusedGroup && focusedGroup.kind === 'resourceGroup') {
            assert.strictEqual(focusedGroup.id, rg2Id.toLowerCase(), 'Second focused group ID should match');
        }
    });

    test("focusResourceGroup should handle resource group IDs with different casing", async () => {
        const mockResources = createMockSubscriptionWithFunctions();
        const resourceGroupId = mockResources.sub1.rg1.id;
        const upperCaseId = resourceGroupId.toUpperCase();

        // Set grouping mode and populate tree
        await commands.executeCommand('azureResourceGroups.groupBy.resourceGroup');
        const tdp = api().azureResourceTreeDataProvider;
        const subscriptions = await tdp.getChildren();
        await tdp.getChildren(subscriptions![0]);

        // Call with uppercase ID
        await api().focusResourceGroup(upperCaseId);

        // Verify that the focused group was set with normalized (lowercase) ID
        const focusedGroup = getCachedTestApi().extensionVariables.getFocusedGroup();
        assert.ok(focusedGroup, 'Focused group should be set');
        assert.strictEqual(focusedGroup.kind, 'resourceGroup', 'Focused group kind should be resourceGroup');
        if (focusedGroup && focusedGroup.kind === 'resourceGroup') {
            assert.strictEqual(focusedGroup.id, resourceGroupId.toLowerCase(), 'Focused group ID should be normalized to lowercase');
        }
    });
});
