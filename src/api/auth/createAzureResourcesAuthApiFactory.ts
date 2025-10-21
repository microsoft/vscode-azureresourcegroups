/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { apiUtils, AzureExtensionApiFactory, callWithTelemetryAndErrorHandling, GetApiOptions, IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtCredentialManager } from '../../../api/src/auth/AzExtCredentialManager';
import { AzureResourcesAuthApiInternal } from '../../hostapi.v4.internal';
import { createAzureResourcesApiSessionInternal, verifyAzureResourcesApiSessionInternal } from './authApiInternal';

const v4: string = '4.0.0';

export function createAzureResourcesAuthApiFactory(credentialManager: AzExtCredentialManager<unknown>, azureResourcesApiProvider: apiUtils.AzureExtensionApiProvider): AzureExtensionApiFactory<AzureResourcesAuthApiInternal> {
    return {
        apiVersion: v4,
        createApi: (options?: GetApiOptions) => {
            return {
                apiVersion: v4,
                getAzureResourcesApi: async (clientExtensionId: string, azureResourcesApiVersions: string[], azureResourcesCredential: string) => {
                    return await callWithTelemetryAndErrorHandling('api.getAzureResourcesApi', async (context: IActionContext) => {
                        addCommonTelemetryAndErrorHandling(context, options?.extensionId);

                        const verified: boolean = await verifyAzureResourcesApiSessionInternal(context, credentialManager, clientExtensionId, azureResourcesCredential);
                        if (!verified) {
                            return [];
                        }

                        return azureResourcesApiVersions
                            .map((apiVersion) => {
                                try {
                                    return azureResourcesApiProvider.getApi(apiVersion, options);
                                } catch {
                                    return undefined;
                                }
                            });

                    }) ?? [];
                },
                createAzureResourcesApiSession: async (clientExtensionId: string, clientExtensionVersion: string, clientExtensionCredential: string) => {
                    return await callWithTelemetryAndErrorHandling('api.createAzureResourcesApiSession', async (context: IActionContext) => {
                        addCommonTelemetryAndErrorHandling(context, options?.extensionId);
                        return await createAzureResourcesApiSessionInternal(context, credentialManager, clientExtensionId, clientExtensionVersion, clientExtensionCredential);
                    });
                },
            };
        },
    };
}

function addCommonTelemetryAndErrorHandling(context: IActionContext, extensionId?: string): void {
    context.telemetry.properties.callingExtensionId = extensionId;
    context.telemetry.properties.isActivationEvent = 'true';
    context.telemetry.properties.apiVersion = '4.0.0';
    context.errorHandling.rethrow = true;
    context.errorHandling.suppressDisplay = true;
    context.errorHandling.suppressReportIssue = true;
}
