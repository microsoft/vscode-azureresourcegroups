/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strictEqual } from 'assert';
import { AzExtResourceType, getAzExtResourceType } from '../api/src';
import { getName } from '../src/utils/azExtResourceTypeDisplayName';

suite('Container Apps Sandbox Groups resource type', () => {
    test('maps the ARM resource type', () => {
        strictEqual(
            getAzExtResourceType({ type: 'Microsoft.App/sandboxGroups' }),
            AzExtResourceType.ContainerAppsSandboxGroups,
        );
    });

    test('uses the Container Apps Sandboxes display name', () => {
        strictEqual(getName(AzExtResourceType.ContainerAppsSandboxGroups), 'Container Apps Sandboxes');
    });
});
