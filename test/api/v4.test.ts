/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import assert = require("assert");
import { apiUtils } from "../../extension.bundle";

suite('v4 API tests', async () => {
    test('v4 API should be defined', async () => {
        const apiProvider = await apiUtils.getExtensionExports<apiUtils.AzureExtensionApiProvider>('ms-azuretools.vscode-azureresourcegroups');

        assert.ok(apiProvider, 'API provider is undefined');

        const v4Api = apiProvider.getApi('^4.0.0', {
            extensionId: 'ms-azuretools.vscode-azureresourcegroups-tests',
        });

        assert.ok(v4Api);
    });
});
