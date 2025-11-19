/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { apiUtils, AuthApiFactoryDependencies, AzureExtensionApi, AzureExtensionApiFactory, AzureResourcesExtensionAuthApi, createApiProvider, createAuthApiFactory, GetApiOptions } from "../../../extension.bundle";

/**
 * Creates a mock API provider with API factories matching the versions provided.
 * Only the values required by the interface will be implemented.
 */
function createMockApiProvider(versions: string[]): apiUtils.AzureExtensionApiProvider {
    const apiFactories: AzureExtensionApiFactory<AzureExtensionApi>[] = versions.map(version => {
        return {
            apiVersion: version,
            createApi: (_options?: GetApiOptions) => {
                return {
                    apiVersion: version,
                };
            },
        };
    });

    return createApiProvider(apiFactories);
}

/**
 * Creates a mock auth API protecting core API versions: ['0.0.1', '2.0.0', '3.0.0']
 */
export function createMockAuthApi(customDependencies?: AuthApiFactoryDependencies): AzureResourcesExtensionAuthApi {
    const coreApiVersions: string[] = ['0.0.1', '2.0.0', '3.0.0'];
    const coreApiProvider = createMockApiProvider(coreApiVersions);
    const authApiProvider = createAuthApiFactory(coreApiProvider, customDependencies);
    return authApiProvider.createApi({ extensionId: 'ms-azuretools.vscode-azureresourcegroups-tests' });
}
