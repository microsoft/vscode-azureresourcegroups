/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "assert";
import { ExtensionContext } from "vscode";
import { getAzureResourcesExtensionApi } from "../../api/src";

suite('getAzureResourcesExtensionApi() tests', async () => {
    async function getApi() {
        return await getAzureResourcesExtensionApi({
            extension: {
                id: 'ms-azuretools.vscode-azuretestextension'
            }
        } as ExtensionContext, '2.0.0');
    }

    test("getAzureResourcesExtensionApi() should return an API instance which has a 'resources' property", async () => {
        const api = await getApi();
        assert.ok(api.resources);
    });

    test("getAzureResourcesExtensionApi() should return unique instances of the API", async () => {
        const api1 = await getApi();
        const api2 = await getApi();
        assert.notStrictEqual(api1, api2);
    });

    test("getAzureResourcesExtensionApi() should return a frozen object", async () => {
        const api = await getApi();
        assert(Object.isFrozen(api));
    });
});
