/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { apiUtils } from "@microsoft/vscode-azext-utils";
import assert from "assert";

suite('v1 API tests', async () => {
    test('v1 API should be defined', async () => {
        const apiProvider = await apiUtils.getExtensionExports<apiUtils.AzureExtensionApiProvider>('ms-azuretools.vscode-azureresourcegroups');

        assert.ok(apiProvider, 'API provider is undefined');

        const v1Api = apiProvider.getApi('0.0.1', {
            extensionId: 'ms-azuretools.vscode-azureresourcegroups-tests',
        });

        assert.ok(v1Api);
    });
});
