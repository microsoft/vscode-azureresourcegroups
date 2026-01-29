/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "assert";
import { Identity } from "@azure/arm-msi";
import { GenericResource } from "@azure/arm-resources";
import { AzureSubscription } from "../api/src";
import { SourceResourceIdentityItem } from "../src/managedIdentity/SourceResourceIdentityItem";
import { getAccountAndTenantPrefix } from "../src/tree/azure/idPrefix";

suite('SourceResourceIdentityItem tests', () => {
    test('Resource IDs use account/tenant prefix for uniqueness', () => {
        const subscription: AzureSubscription = {
            subscriptionId: 'test-sub-id',
            name: 'Test Subscription',
            tenantId: 'test-tenant-id',
            account: {
                id: 'test-account-id',
            },
        } as AzureSubscription;

        const msiId = '/subscriptions/test-sub-id/resourceGroups/test-rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/test-msi';
        const msi: Identity = {
            id: msiId,
            name: 'test-msi',
            location: 'eastus',
        };

        const resourceId = '/subscriptions/test-sub-id/resourceGroups/test-rg/providers/Microsoft.Web/sites/test-function';
        const resource: GenericResource = {
            id: resourceId,
            name: 'test-function',
            type: 'Microsoft.Web/sites',
            location: 'eastus',
            identity: {
                type: 'UserAssigned',
                userAssignedIdentities: {
                    [msiId]: {}
                }
            }
        };

        const sourceResourceItem = new SourceResourceIdentityItem(subscription, msi, [resource]);
        const children = sourceResourceItem.getChildren();

        assert.strictEqual(children.length, 1, 'Should have one child resource');
        
        const childId = children[0].id;
        const expectedPrefix = getAccountAndTenantPrefix(subscription);
        
        // Verify the ID starts with account/tenant prefix
        assert.ok(childId.startsWith(expectedPrefix), 
            `Child ID should start with account/tenant prefix. Expected prefix: ${expectedPrefix}, Actual ID: ${childId}`);
        
        // Verify the ID includes the MSI context
        assert.ok(childId.includes(msiId), 
            `Child ID should include MSI ID for uniqueness. MSI ID: ${msiId}, Actual ID: ${childId}`);
        
        // Verify the ID includes the resource ID
        assert.ok(childId.includes(resourceId), 
            `Child ID should include resource ID. Resource ID: ${resourceId}, Actual ID: ${childId}`);
    });

    test('DefaultAzureResourceItem applies custom treeItemId', async () => {
        const subscription: AzureSubscription = {
            subscriptionId: 'test-sub-id',
            name: 'Test Subscription',
            tenantId: 'test-tenant-id',
            account: {
                id: 'test-account-id',
            },
        } as AzureSubscription;

        const msiId = '/subscriptions/test-sub-id/resourceGroups/test-rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/test-msi';
        const msi: Identity = {
            id: msiId,
            name: 'test-msi',
            location: 'eastus',
        };

        const resourceId = '/subscriptions/test-sub-id/resourceGroups/test-rg/providers/Microsoft.Web/sites/test-function';
        const resource: GenericResource = {
            id: resourceId,
            name: 'test-function',
            type: 'Microsoft.Web/sites',
            location: 'eastus',
            identity: {
                type: 'UserAssigned',
                userAssignedIdentities: {
                    [msiId]: {}
                }
            }
        };

        const sourceResourceItem = new SourceResourceIdentityItem(subscription, msi, [resource]);
        const children = sourceResourceItem.getChildren();

        assert.strictEqual(children.length, 1, 'Should have one child resource');
        
        const treeItem = await children[0].getTreeItem();
        const childId = children[0].id;
        
        // Verify the TreeItem ID matches the custom treeItemId
        assert.strictEqual(treeItem.id, childId, 
            'TreeItem.id should match the custom treeItemId from the resource item');
    });
});
