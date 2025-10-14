/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from '@microsoft/vscode-azext-utils';
import { wrapFunctionsInTelemetry } from '../utils/wrapFunctionsInTelemetry';
import { AzureResourcesAuthApi } from './AzureResourcesAuthApi';

export function createWrappedAzureResourcesExtensionAuthApi(api: AzureResourcesAuthApi, extensionId: string): AzureResourcesAuthApi {
    const wrapOptions = {
        callbackIdPrefix: 'api.',
        beforeHook: (context: IActionContext) => {
            context.telemetry.properties.callingExtensionId = extensionId;
            context.telemetry.properties.apiVersion = api.apiVersion;
        }
    };

    return Object.freeze({
        apiVersion: api.apiVersion,
        ...wrapFunctionsInTelemetry({
            createAzExtResourcesSession: api.createAzExtResourcesSession.bind(api) as typeof api.createAzExtResourcesSession,
            getAzExtResourcesApi: api.getAzExtResourcesApi.bind(api) as typeof api.getAzExtResourcesApi,
        }, wrapOptions),
    });
}
