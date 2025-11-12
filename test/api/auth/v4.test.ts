/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import { apiUtils, AzExtCredentialManager, AzureResourcesExtensionAuthApi, createAzureResourcesAuthApiFactory, nonNullValue, parseError } from "../../../extension.bundle";
import { assertThrowsAsync } from "../../wrapFunctionsInTelemetry.test";
import { MockUUIDCredentialManager } from "./MockUUIDCredentialManager";
import { createMockApiProvider } from "./mockApiProvider";

const extensionId: string = 'ms-azuretools.vscode-azureresourcegroups';
const extensionVersion: string = '^4.0.0';
const coreApiVersions: string[] = ['0.0.1', '2.0.0', '3.0.0'];

suite('v4 API auth tests', async () => {
    test('v4 API should be defined', async () => {
        const apiProvider = await apiUtils.getExtensionExports<apiUtils.AzureExtensionApiProvider>(extensionId);
        assert.ok(apiProvider, 'API provider is undefined');

        const v4Api = apiProvider.getApi(extensionVersion, { extensionId: 'ms-azuretools.vscode-azureresourcegroups-tests' });
        assert.ok(v4Api);
    });

    // NOTE: `createAzureResourcesApiSession` is not normally intended to be called directly by Azure Resources itself; however, I've found that it
    // kind of still works for testing.  It will basically run everything exactly the same except at the end - the exported API for Azure Resources will be missing
    // the receiver method so the credential has no way to be passed back to the extension through its API.
    // Since we inject and hold a copy of the credential manager during tests, we can simply grab the generated credential from the manager.
    // Client side handshake testing should be done separately to ensure that the receiver method is being called and passed the correct credential.

    test('createAzureResourcesApiSession should provide a credential but not return it directly', async () => {
        const credentialManager = new MockUUIDCredentialManager();
        const authApi: AzureResourcesExtensionAuthApi = createAuthApi(credentialManager, coreApiVersions);

        const apiSession = await authApi.createAzureResourcesApiSession(extensionId, extensionVersion, crypto.randomUUID());
        assert.equal(apiSession, undefined);
        assert.ok(credentialManager.uuidMap.get(extensionId));
    });

    test('createAzureResourcesApiSession should throw if an unallowed extension id is provided', async () => {
        const credentialManager = new MockUUIDCredentialManager();
        const authApi: AzureResourcesExtensionAuthApi = createAuthApi(credentialManager, coreApiVersions);
        assertThrowsAsync(async () => await authApi.createAzureResourcesApiSession('extension1', extensionVersion, crypto.randomUUID()))
    });

    test('createAzureResourcesApiSession should not spill sensitive extension credentials in errors', async () => {
        const credentialManager = new MockUUIDCredentialManager();
        credentialManager.createCredential('extension1');
        credentialManager.createCredential = () => {
            throw new Error(credentialManager.uuidMap.get('extension1'));
        }

        const authApi: AzureResourcesExtensionAuthApi = createAuthApi(credentialManager, coreApiVersions);

        try {
            await authApi.createAzureResourcesApiSession(extensionId, extensionVersion, crypto.randomUUID());
            assert.fail('We expect the credential manager to throw in this test.');
        } catch (err) {
            const perr = parseError(err);
            assert.doesNotMatch(perr.message, new RegExp(nonNullValue(credentialManager.uuidMap.get('extension1')), 'i'));
        }
    });

    test('getAzureResourcesApis should return matching APIs if provided a valid credential', async () => {
        const credentialManager = new MockUUIDCredentialManager();

        const authApi: AzureResourcesExtensionAuthApi = createAuthApi(credentialManager, coreApiVersions);
        await authApi.createAzureResourcesApiSession(extensionId, extensionVersion, crypto.randomUUID());

        const resourcesApis = await authApi.getAzureResourcesApis(extensionId, nonNullValue(credentialManager.uuidMap.get(extensionId)), ['0.0.1', '^2.0.0']);
        assert.match(resourcesApis[0]?.apiVersion ?? '', /^0.0.1$/);
        assert.match(resourcesApis[1]?.apiVersion ?? '', /^2./);
    });

    test('getAzureResourcesApis should throw if provided an invalid credential', async () => {
        const credentialManager = new MockUUIDCredentialManager();
        const coreApiVersions: string[] = ['0.0.1', '2.0.0', '3.0.0'];
        const authApi: AzureResourcesExtensionAuthApi = createAuthApi(credentialManager, coreApiVersions);
        assertThrowsAsync(async () => await authApi.getAzureResourcesApis(extensionId, crypto.randomUUID(), ['^2.0.0']));
    });

    test('getAzureResourcesApis should not spill sensitive extension credentials in errors', async () => {
        const credentialManager = new MockUUIDCredentialManager();
        const authApi: AzureResourcesExtensionAuthApi = createAuthApi(credentialManager, coreApiVersions);

        credentialManager.createCredential('extension1');
        credentialManager.createCredential('extension2');
        credentialManager.createCredential('extension3');

        try {
            await authApi.getAzureResourcesApis(extensionId, crypto.randomUUID(), ['^2.0.0']);
            assert.fail('Should throw if requesting Azure Resources APIs without a valid credential.');
        } catch (err) {
            const perr = parseError(err);
            for (const credential of credentialManager.uuidMap.values()) {
                assert.doesNotMatch(perr.message, new RegExp(credential, 'i'));
            }
        }
    });
});

/**
 * Use to quickly bootstrap a testable auth API with core API factories matching the provided versions.
 */
function createAuthApi(credentialManager: AzExtCredentialManager, coreApiVersions: string[]): AzureResourcesExtensionAuthApi {
    const coreApiProvider = createMockApiProvider(coreApiVersions);
    const authApiProvider = createAzureResourcesAuthApiFactory(credentialManager, coreApiProvider);
    return authApiProvider.createApi({ extensionId: 'ms-azuretools.vscode-azureresourcegroups-tests' });
}
