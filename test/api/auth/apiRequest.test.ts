/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import { AzExtUUIDCredentialManager, AzureExtensionApi, AzureResourcesApiRequestError, AzureResourcesApiRequestErrorCode, AzureResourcesApiRequestTestContext, AzureResourcesExtensionApi, prepareAzureResourcesApiRequest } from "../../../extension.bundle";
import { createMockAuthApi } from "./mockAuthApiFactory";

const clientExtensionId: string = 'ms-azuretools.vscode-azurecontainerapps';

suite('Azure Resources API - client request tooling tests', async () => {
    test('prepareAzureResourcesApiRequest should successfully complete a handshake & return available APIs if on the allow list', async () => {
        let receivedAzureResourcesApis: (AzureExtensionApi | AzureResourcesExtensionApi | undefined)[] = [];

        await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 5000);

            const requestContext: AzureResourcesApiRequestTestContext = {
                clientExtensionId,
                azureResourcesApiVersions: ['0.0.1', '^2.0.0'],
                onDidReceiveAzureResourcesApis: (azureResourcesApis: (AzureExtensionApi | AzureResourcesExtensionApi | undefined)[]) => {
                    clearTimeout(timeout);
                    receivedAzureResourcesApis = azureResourcesApis;
                    resolve();
                },
                onApiRequestError: () => {
                    clearTimeout(timeout);
                    resolve();
                },
            };

            const coreClientExtensionApi: AzureExtensionApi = {
                apiVersion: '1.0.0',
            };

            // Define an external manager so the two preparation calls below can point to the same credential manager
            requestContext.customCredentialManager = new AzExtUUIDCredentialManager();

            // For testing, it is necessary to wire up a custom client and host api provider so that the mocked
            // host and client APIs have a way to talk with one another.
            // The prepare call needs to happen twice in this scenario, once to get the client API that the host needs to point to, and then again to
            // pass in the generated host API which the client will need to point to.
            // This is not normally necessary outside of a test environment since we can normally just rely on the VS Code API without having to inject our own extension provider.
            const { clientApi } = prepareAzureResourcesApiRequest(requestContext, coreClientExtensionApi);
            const hostApiProvider = createMockAuthApi({ clientApiProvider: { getApi: () => clientApi } });
            requestContext.customHostApiProvider = { getApi: () => hostApiProvider };

            const { requestResourcesApis } = prepareAzureResourcesApiRequest(requestContext, clientApi);
            requestResourcesApis();
        });

        assert.match(receivedAzureResourcesApis[0]?.apiVersion ?? '', /^0.0.1$/);
        assert.match(receivedAzureResourcesApis[1]?.apiVersion ?? '', /^2./);
    });

    test('prepareAzureResourcesApiRequest should return an error if not on the allow list', async () => {
        let receivedError: AzureResourcesApiRequestError | undefined;

        await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 5000);

            const requestContext: AzureResourcesApiRequestTestContext = {
                clientExtensionId: 'extension1',
                azureResourcesApiVersions: ['0.0.1', '^2.0.0'],
                onDidReceiveAzureResourcesApis: () => {
                    clearTimeout(timeout);
                    resolve();
                },
                onApiRequestError: (error: AzureResourcesApiRequestError) => {
                    clearTimeout(timeout);
                    receivedError = error;
                    resolve();
                }
            };

            const coreClientExtensionApi: AzureExtensionApi = {
                apiVersion: '1.0.0',
            };

            // We don't need to wire up with custom test api providers as we expect the initial call to fail right away
            const { requestResourcesApis } = prepareAzureResourcesApiRequest(requestContext, coreClientExtensionApi);
            requestResourcesApis();
        });

        assert.equal(receivedError?.code, AzureResourcesApiRequestErrorCode.HostCreateSessionFailed);
    });
});
