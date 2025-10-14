/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureExtensionApi, AzureExtensionApiFactory, callWithTelemetryAndErrorHandling, GetApiOptions, IActionContext } from '@microsoft/vscode-azext-utils';
import { AzureResourcesApiInternal } from '../../hostapi.v2.internal';
import { createAzureResourcesApiSessionInternal, getAzureResourcesApiSessionInternal } from './resourcesApiSession';

export interface AzureResourcesAuthApi extends AzureExtensionApi {
    getAzureResourcesApi(azureResourcesToken: string): Promise<AzureResourcesApiInternal | undefined>;
    createAzureResourcesApiSession(clientExtensionId: string, clientExtensionVersion: string, clientExtensionToken: string): Promise<void>;
}

export function createAzureResourcesAuthApiFactory(resourcesApiInternalFactory: AzureExtensionApiFactory<AzureResourcesApiInternal>): AzureExtensionApiFactory<AzureResourcesAuthApi> {
    return {
        apiVersion: '3.0.0',
        createApi: (options?: GetApiOptions) => {
            return {
                apiVersion: '3.0.0',
                getAzureResourcesApi: async (azureResourcesToken: string) => {
                    return await callWithTelemetryAndErrorHandling('api.getAzureResourcesApi', async (context: IActionContext) => {
                        addAuthTelemetryAndErrorHandling(context, options?.extensionId);
                        const { clientExtensionId } = await getAzureResourcesApiSessionInternal(context, azureResourcesToken);
                        return resourcesApiInternalFactory.createApi({ extensionId: clientExtensionId });
                    });
                },
                createAzureResourcesApiSession: async (clientExtensionId: string, clientExtensionVersion: string, clientExtensionToken: string) => {
                    return await callWithTelemetryAndErrorHandling('api.createAzureResourcesApiSession', async (context: IActionContext) => {
                        addAuthTelemetryAndErrorHandling(context, options?.extensionId);
                        return await createAzureResourcesApiSessionInternal(context, clientExtensionId, clientExtensionVersion, clientExtensionToken);
                    });
                },
            };
        },
    };
}

function addAuthTelemetryAndErrorHandling(context: IActionContext, extensionId?: string): void {
    context.telemetry.properties.callingExtensionId = extensionId;
    context.telemetry.properties.isActivationEvent = 'true';
    context.telemetry.properties.apiVersion = '3.0.0';
    context.errorHandling.rethrow = true;
    context.errorHandling.suppressDisplay = true;
    context.errorHandling.suppressReportIssue = true;
}
