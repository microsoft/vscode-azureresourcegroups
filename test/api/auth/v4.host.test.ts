/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import { apiUtils, AzureExtensionApi, AzureResourcesExtensionAuthApi, nonNullValue, parseError } from "../../../extension.bundle";
import { assertThrowsAsync } from "../../wrapFunctionsInTelemetry.test";
import { MockUUIDCredentialManager } from "./MockUUIDCredentialManager";
import { createMockAuthApi } from "./mockAuthApi";

const clientExtensionId: string = 'ms-azuretools.vscode-azurecontainerapps';
const clientExtensionVersion: string = '1.0.0';

suite('v4 internal API auth tests', async () => {
    test('v4 API should be defined', async () => {
        const apiProvider = await apiUtils.getExtensionExports<apiUtils.AzureExtensionApiProvider>('ms-azuretools.vscode-azureresourcegroups');
        assert.ok(apiProvider, 'API provider is undefined');

        const v4Api = apiProvider.getApi('^4.0.0', { extensionId: 'ms-azuretools.vscode-azureresourcegroups-tests' });
        assert.ok(v4Api);
    });

    test('createAzureResourcesApiSession should provide a valid credential but not return it directly', async () => {
        let apiSession: unknown;
        let receivedHostCredential: string = '';
        let receivedClientCredential: string = '';

        const credentialManager = new MockUUIDCredentialManager();
        const generatedClientCredential: string = crypto.randomUUID();

        await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 5000);

            const mockClientExtensionApi: AzureExtensionApi = {
                apiVersion: clientExtensionVersion,
                receiveAzureResourcesApiSession: (hostCredential: string, clientCredential: string) => {
                    clearTimeout(timeout);
                    receivedHostCredential = hostCredential;
                    receivedClientCredential = clientCredential;
                    resolve();
                },
            }

            const authApi: AzureResourcesExtensionAuthApi = createMockAuthApi({ credentialManager, clientApiProvider: { getApi: () => mockClientExtensionApi } });
            authApi.createAzureResourcesApiSession(clientExtensionId, clientExtensionVersion, generatedClientCredential)
                .then(session => apiSession = session)
                .catch(() => { clearTimeout(timeout); resolve() });
        });

        assert.equal(apiSession, undefined);
        assert.equal(receivedClientCredential, generatedClientCredential);

        const generatedHostCredential: string = nonNullValue(credentialManager.uuidMap.get(clientExtensionId));
        assert.equal(receivedHostCredential, generatedHostCredential);
    });

    test('createAzureResourcesApiSession should throw if an unallowed extension id is provided', async () => {
        const authApi: AzureResourcesExtensionAuthApi = createMockAuthApi();
        assertThrowsAsync(async () => await authApi.createAzureResourcesApiSession('extension1', clientExtensionVersion, crypto.randomUUID()));
    });

    test('createAzureResourcesApiSession should not spill sensitive extension credentials in errors', async () => {
        const credentialManager = new MockUUIDCredentialManager();
        credentialManager.createCredential('extension1');
        credentialManager.createCredential = () => {
            throw new Error(credentialManager.uuidMap.get('extension1'));
        }

        const authApi: AzureResourcesExtensionAuthApi = createMockAuthApi({ credentialManager });

        try {
            await authApi.createAzureResourcesApiSession(clientExtensionId, clientExtensionVersion, crypto.randomUUID());
            assert.fail('We expect the credential manager to throw in this test.');
        } catch (err) {
            const perr = parseError(err);
            assert.doesNotMatch(perr.message, new RegExp(nonNullValue(credentialManager.uuidMap.get('extension1')), 'i'));
        }
    });

    test('getAzureResourcesApis should return matching APIs if provided a valid credential', async () => {
        const credentialManager = new MockUUIDCredentialManager();
        const generatedHostCredential: string = credentialManager.createCredential(clientExtensionId);

        const authApi: AzureResourcesExtensionAuthApi = createMockAuthApi({ credentialManager });
        const resourcesApis = await authApi.getAzureResourcesApis(clientExtensionId, generatedHostCredential, ['0.0.1', '^2.0.0']);

        assert.equal(resourcesApis[0]?.apiVersion, '0.0.1');
        assert.match(resourcesApis[1]?.apiVersion ?? '', /^2./);
    });

    test('getAzureResourcesApis should throw if provided an invalid credential', async () => {
        const authApi: AzureResourcesExtensionAuthApi = createMockAuthApi();
        assertThrowsAsync(async () => await authApi.getAzureResourcesApis(clientExtensionId, crypto.randomUUID(), ['^2.0.0']));
    });

    test('getAzureResourcesApis should not spill sensitive extension credentials in errors', async () => {
        const credentialManager = new MockUUIDCredentialManager();
        const authApi: AzureResourcesExtensionAuthApi = createMockAuthApi({ credentialManager });

        credentialManager.createCredential('extension1');
        credentialManager.createCredential('extension2');
        credentialManager.createCredential('extension3');

        try {
            await authApi.getAzureResourcesApis(clientExtensionId, crypto.randomUUID(), ['^2.0.0']);
            assert.fail('Should throw if requesting Azure Resources APIs without a valid credential.');
        } catch (err) {
            const perr = parseError(err);
            for (const credential of credentialManager.uuidMap.values()) {
                assert.doesNotMatch(perr.message, new RegExp(credential, 'i'));
            }
        }
    });
});
