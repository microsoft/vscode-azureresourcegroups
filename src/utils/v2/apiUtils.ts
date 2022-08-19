/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandlingSync, IActionContext } from '@microsoft/vscode-azext-utils';
import * as semver from 'semver';
import { AzureResourcesApiBase, AzureResourcesApiManager, GetApiOptions } from '../../api/v2/v2AzureResourcesApi';
import { localize } from '../localize';

export type AzureResourcesApiRegistration = { apiVersion: string, apiFactory: (options?: GetApiOptions) => AzureResourcesApiBase };

export function createApiProvider(extensionId: string, azExts: AzureResourcesApiRegistration[]): AzureResourcesApiManager {
    for (const azExt of azExts) {
        if (!semver.valid(azExt.apiVersion)) {
            throw new Error(localize('invalidVersion', 'Invalid semver "{0}".', azExt.apiVersion));
        }
    }

    return {
        getApi: <T extends AzureResourcesApiBase>(versionRange: string, options?: GetApiOptions): T | undefined => getApiInternal<T>(azExts, extensionId, versionRange, options)
    };
}

type ApiVersionCode = 'NoLongerSupported' | 'NotYetSupported';

class ApiVersionError extends Error {
    constructor(message: string, readonly code: ApiVersionCode) {
        super(message);
    }
}

function getApiInternal<T extends AzureResourcesApiBase>(azExts: AzureResourcesApiRegistration[], extensionId: string, apiVersionRange: string, options: GetApiOptions | undefined): T {
    return <T>callWithTelemetryAndErrorHandlingSync('getApi', (context: IActionContext) => {
        context.errorHandling.rethrow = true;
        context.errorHandling.suppressDisplay = true;
        context.telemetry.properties.isActivationEvent = 'true';

        context.telemetry.properties.apiVersionRange = apiVersionRange;

        const apiVersions: string[] = azExts.map(a => a.apiVersion);
        context.telemetry.properties.apiVersions = apiVersions.join(', ');

        const matchedApiVersion: string | null = semver.maxSatisfying(apiVersions, apiVersionRange);
        if (matchedApiVersion) {
            const api = azExts.find(a => a.apiVersion === matchedApiVersion);

            if (api) {
                return <T>api.apiFactory(options);
            } else {
                return undefined;
            }
        } else {
            const minApiVersion: string | null = semver.minSatisfying(apiVersions, '');
            let message: string;
            let code: ApiVersionCode;
            if (minApiVersion && semver.gtr(minApiVersion, apiVersionRange)) {
                // This case will hopefully never happen if we maintain backwards compat
                message = localize('notSupported', 'API version "{0}" for extension id "{1}" is no longer supported. Minimum version is "{2}".', apiVersionRange, extensionId, minApiVersion);
                code = 'NoLongerSupported';
            } else {
                // This case is somewhat likely - so keep the error message simple and just tell user to update their extenion
                message = localize('updateExtension', 'Extension dependency with id "{0}" must be updated.', extensionId);
                code = 'NotYetSupported';
            }

            throw new ApiVersionError(message, code);
        }
    });
}
