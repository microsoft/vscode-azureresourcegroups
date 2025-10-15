/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureExtensionApiFactory, callWithTelemetryAndErrorHandling, GetApiOptions, IActionContext } from '@microsoft/vscode-azext-utils';
import { AzureResourcesApiInternal } from '../../hostapi.v2.internal';
import { AzureResourcesAuthApiInternal } from '../../hostapi.v3.internal';
import { createAzureResourcesApiSessionInternal, verifyAzureResourcesApiSessionInternal } from './authApiInternal';

export function createAzureResourcesAuthApiFactory(resourcesApiInternalFactory: AzureExtensionApiFactory<AzureResourcesApiInternal>): AzureExtensionApiFactory<AzureResourcesAuthApiInternal> {
    return {
        apiVersion: '3.0.0',
        createApi: (options?: GetApiOptions) => {
            return {
                apiVersion: '3.0.0',
                getAzureResourcesApi: async (clientExtensionId: string, azureResourcesCredential: string) => {
                    return await callWithTelemetryAndErrorHandling('api.getAzureResourcesApi', async (context: IActionContext) => {
                        addCommonAuthTelemetryAndErrorHandling(context, options?.extensionId);
                        return await verifyAzureResourcesApiSessionInternal(context, clientExtensionId, azureResourcesCredential) ?
                            resourcesApiInternalFactory.createApi({ extensionId: clientExtensionId }) : undefined;
                    });
                },
                createAzureResourcesApiSession: async (clientExtensionId: string, clientExtensionVersion: string, clientExtensionCredential: string) => {
                    return await callWithTelemetryAndErrorHandling('api.createAzureResourcesApiSession', async (context: IActionContext) => {
                        addCommonAuthTelemetryAndErrorHandling(context, options?.extensionId);
                        return await createAzureResourcesApiSessionInternal(context, clientExtensionId, clientExtensionVersion, clientExtensionCredential);
                    });
                },
            };
        },
    };
}

function addCommonAuthTelemetryAndErrorHandling(context: IActionContext, extensionId?: string): void {
    context.telemetry.properties.callingExtensionId = extensionId;
    context.telemetry.properties.isActivationEvent = 'true';
    context.telemetry.properties.apiVersion = '3.0.0';
    context.errorHandling.rethrow = true;
    context.errorHandling.suppressDisplay = true;
    context.errorHandling.suppressReportIssue = true;
}
