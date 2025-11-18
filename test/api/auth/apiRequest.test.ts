/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

// import * as assert from "assert";
// import { apiUtils } from "../../../extension.bundle";

// const extensionId: string = 'ms-azuretools.vscode-azureresourcegroups';
// const extensionVersion: string = '^4.0.0';
// const coreApiVersions: string[] = ['0.0.1', '2.0.0', '3.0.0'];

// suite('v4 API SDK auth tests', async () => {
//     test('v4 API should be defined', async () => {
//         const apiProvider = await apiUtils.getExtensionExports<apiUtils.AzureExtensionApiProvider>(extensionId);
//         assert.ok(apiProvider, 'API provider is undefined');

//         const v4Api = apiProvider.getApi(extensionVersion, { extensionId: 'ms-azuretools.vscode-azureresourcegroups-tests' });
//         assert.ok(v4Api);
//     });

//     const authApi: AzureResourcesExtensionAuthApi = createMockAuthApi(coreApiVersions, { credentialManager });
//     await authApi.createAzureResourcesApiSession(extensionId, extensionVersion, crypto.randomUUID());
// });
