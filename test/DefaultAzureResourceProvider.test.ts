/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GenericResource } from '@azure/arm-resources';
import { deepStrictEqual } from 'assert';
import { clearAzureResourceDeleted, filterDeletedAzureResources, markAzureResourceDeleted } from '../src/api/DefaultAzureResourceProvider';

suite('DefaultAzureResourceProvider', () => {
    test('hides a deleted resource until Azure stops listing it', () => {
        const subscriptionId = '00000000-0000-0000-0000-000000000001';
        const resource: GenericResource = {
            id: `/subscriptions/${subscriptionId}/resourceGroups/test-rg/providers/Microsoft.App/sandboxGroups/deleted-group`,
            name: 'deleted-group',
            type: 'Microsoft.App/sandboxGroups',
        };

        markAzureResourceDeleted(resource.id!);
        deepStrictEqual(filterDeletedAzureResources(subscriptionId, [resource]), []);
        deepStrictEqual(filterDeletedAzureResources(subscriptionId, []), []);
        deepStrictEqual(filterDeletedAzureResources(subscriptionId, [resource]), [resource]);
    });

    test('does not clear deletion state while refreshing another subscription', () => {
        const subscriptionId = '00000000-0000-0000-0000-000000000002';
        const resource: GenericResource = {
            id: `/subscriptions/${subscriptionId}/resourceGroups/test-rg/providers/Microsoft.App/sandboxGroups/deleted-group`,
            name: 'deleted-group',
            type: 'Microsoft.App/sandboxGroups',
        };

        markAzureResourceDeleted(resource.id!);
        filterDeletedAzureResources('00000000-0000-0000-0000-000000000003', []);
        deepStrictEqual(filterDeletedAzureResources(subscriptionId, [resource]), []);
        filterDeletedAzureResources(subscriptionId, []);
    });

    test('shows a recreated resource after its deletion state is cleared', () => {
        const subscriptionId = '00000000-0000-0000-0000-000000000004';
        const resource: GenericResource = {
            id: `/subscriptions/${subscriptionId}/resourceGroups/test-rg/providers/Microsoft.App/sandboxGroups/recreated-group`,
            name: 'recreated-group',
            type: 'Microsoft.App/sandboxGroups',
        };

        markAzureResourceDeleted(resource.id!);
        deepStrictEqual(filterDeletedAzureResources(subscriptionId, [resource]), []);

        clearAzureResourceDeleted(resource.id!);
        deepStrictEqual(filterDeletedAzureResources(subscriptionId, [resource]), [resource]);
    });
});
