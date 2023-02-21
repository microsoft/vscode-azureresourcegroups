/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { convertV1TreeItemId } from '../../../extension.bundle';

suite('convertV1TreeItemId', () => {
    const validArmId = '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-rg/providers/Microsoft.ContainerRegistry/registries/test-registry';
    test("Doesn't change a valid ARM id", () => {
        assert.strictEqual(convertV1TreeItemId(validArmId), validArmId);
    });

    test("Converts a v1 tree item id to ARM id", () => {
        const v1TreeItemId = '/subscriptions/00000000-0000-0000-0000-000000000000/ContainerRegistries/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-rg/providers/Microsoft.ContainerRegistry/registries/test-registry';
        assert.strictEqual(convertV1TreeItemId(v1TreeItemId), validArmId);
    });
});
