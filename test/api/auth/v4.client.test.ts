/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import { AzExtUUIDCredentialManager, AzureExtensionApi, AzureResourcesApiRequestContext, AzureResourcesApiRequestError, AzureResourcesApiRequestErrorCode, AzureResourcesExtensionApi, CustomRequestDependenciesContext, prepareAzureResourcesApiRequest } from "../../../extension.bundle";
import { createMockAuthApi } from "./mockAuthApi";

const clientExtensionId: string = 'ms-azuretools.vscode-azurecontainerapps';

suite('Azure Resources API client-side request tests', async () => {
    test('prepareAzureResourcesApiRequest should successfully enable the handshake & return available APIs if on the allow list', async () => {
        let receivedResourcesApis: (AzureExtensionApi | AzureResourcesExtensionApi | undefined)[] = [];

        await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 5000);

            const requestContext: AzureResourcesApiRequestContext = {
                clientExtensionId,
                azureResourcesApiVersions: ['0.0.1', '^2.0.0'],
                onDidReceiveAzureResourcesApis: (azureResourcesApis: (AzureExtensionApi | AzureResourcesExtensionApi | undefined)[]) => {
                    clearTimeout(timeout);
                    receivedResourcesApis = azureResourcesApis;
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

            // Define an external manager so the two preparation calls that follow will point to the same credential manager
            (requestContext as CustomRequestDependenciesContext).credentialManager = new AzExtUUIDCredentialManager();

            // For testing, it is necessary to wire up both the client and host api provider to represent the parties on each side of the handshake.
            // The prepare call needs to happen twice in order to set this scenario up - once to generate the client API for the host to point to,
            // and then once more to pass that client to the host API for the final handshake method to point to.
            //
            // NOTE: This is not normally necessary since VS Code's API normally manages extension exports; however, this is not something we can rely on
            // during tests because we need to be able to test point to our own mocked extension APIs (requiring us to swap out the native VS Code extension provider).

            const { clientApi } = prepareAzureResourcesApiRequest(requestContext, coreClientExtensionApi);
            const hostApi = createMockAuthApi({ clientApiProvider: { getApi: () => clientApi } });
            (requestContext as CustomRequestDependenciesContext).hostApiProvider = { getApi: () => hostApi };

            const { requestResourcesApis } = prepareAzureResourcesApiRequest(requestContext, clientApi);
            requestResourcesApis();
        });

        assert.equal(receivedResourcesApis[0]?.apiVersion, '0.0.1');
        assert.match(receivedResourcesApis[1]?.apiVersion ?? '', /^2./);
    });

    test('prepareAzureResourcesApiRequest should return an error if not on the allow list', async () => {
        let receivedError: AzureResourcesApiRequestError | undefined;

        await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 5000);

            const requestContext: AzureResourcesApiRequestContext = {
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

            // We don't need to wire up the custom test api providers as we expect the initial call to fail before the host ever tries to reach back out to the client
            const { requestResourcesApis } = prepareAzureResourcesApiRequest(requestContext, coreClientExtensionApi);
            requestResourcesApis();
        });

        assert.equal(receivedError?.code, AzureResourcesApiRequestErrorCode.HostCreateSessionFailed);
    });
});
