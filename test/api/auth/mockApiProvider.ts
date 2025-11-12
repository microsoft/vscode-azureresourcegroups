/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { apiUtils, AzureExtensionApi, AzureExtensionApiFactory, createApiProvider, GetApiOptions } from "../../../extension.bundle";

/**
 * Creates a mock API provider with API factories matching the versions provided.
 * Only the values required by the interface will be implemented.
 */
export function createMockApiProvider(versions: string[]): apiUtils.AzureExtensionApiProvider {
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
