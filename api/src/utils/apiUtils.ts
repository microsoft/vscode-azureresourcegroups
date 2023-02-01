/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

export interface AzureExtensionApi {
    /**
     * The API version for this extension. It should be versioned separately from the extension and ideally remains backwards compatible.
     */
    apiVersion: string;
}

export interface GetApiOptions {
    /**
     * The ID of the extension requesting the API.
     *
     * @remarks This is used for telemetry purposes, to measure which extensions are using the API.
     */
    readonly extensionId?: string;
}

export namespace apiUtils {
    export interface AzureExtensionApiProvider {
        /**
         * Provides the API for an Azure Extension.
         *
         * @param apiVersionRange - The version range of the API you need. Any semver syntax is allowed. For example "1" will return any "1.x.x" version or "1.2" will return any "1.2.x" version
         * @param options - Options for initializing the API. See {@link GetApiOptions}
         * @throws - Error if a matching version is not found.
         */
        getApi<T extends AzureExtensionApi>(apiVersionRange: string, options?: GetApiOptions): T;
    }

    export class ExtensionNotFoundError extends Error {
        constructor(extensionId: string) {
            super(`Extension with id ${extensionId} not found.`);
        }
    }

    /**
     * Gets the exported API from the given extension id and version range.
     *
     * @param extensionId - The extension id to get the API from
     * @param apiVersionRange - The version range of the API you need. Any semver syntax is allowed. For example "1" will return any "1.x.x" version or "1.2" will return any "1.2.x" version
     * @param options - The options to pass when creating the API. If `options.extensionId` is left undefined, it's set to the caller extension id.
     * @throws Error if extension with id is not installed.
     */
    export async function getAzureExtensionApi<T extends AzureExtensionApi>(context: vscode.ExtensionContext, extensionId: string, apiVersionRange: string, options?: GetApiOptions): Promise<T> {
        const apiProvider: AzureExtensionApiProvider | undefined = await getExtensionExports(extensionId);

        if (apiProvider) {
            return apiProvider.getApi<T>(apiVersionRange, {
                ...options,
                extensionId: options?.extensionId ?? context.extension.id
            });
        }

        throw new ExtensionNotFoundError(extensionId);
    }

    /**
     * Get extension exports for the extension with the given id. Activates extension first if needed.
     *
     * @returns `undefined` if the extension is not installed
     */
    export async function getExtensionExports<T>(extensionId: string): Promise<T | undefined> {
        const extension: vscode.Extension<T> | undefined = vscode.extensions.getExtension(extensionId);
        if (extension) {
            if (!extension.isActive) {
                await extension.activate();
            }

            return extension.exports;
        }

        return undefined;
    }
}
