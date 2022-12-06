/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureExtensionApi } from '@microsoft/vscode-azext-utils/api';

/**
 * Options affecting the return of an Azure Resources extension API.
 */
export interface GetApiOptions {
    /**
     * The ID of the extension requesting the API.
     *
     * @remarks This is used for telemetry purposes, to measure which extensions are using the API.
     */
    readonly extensionId?: string;
}

/**
 * Exported object of the Azure Resources extension.
 */
export interface AzureResourcesApiManager {
    /**
     * Gets a specific version of the Azure Resources extension API.
     *
     * @typeparam TApi The type of the API.
     * @param versionRange The version of the API to return, specified as a potential (semver) range of versions.
     *
     * @returns The requested API or undefined, if no version of the API matches the specified range.
     */
    getApi<TApi extends AzureExtensionApi>(versionRange: string, options?: GetApiOptions): TApi | undefined
}
