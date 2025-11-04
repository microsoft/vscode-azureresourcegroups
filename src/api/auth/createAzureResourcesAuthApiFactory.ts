/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { apiUtils, AzureExtensionApiFactory, callWithTelemetryAndErrorHandling, GetApiOptions, IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtCredentialManager } from '../../../api/src/auth/credentialManager/AzExtCredentialManager';
import { AzExtUUIDCredentialManager } from '../../../api/src/auth/credentialManager/AzExtUUIDCredentialManager';
import { AzureResourcesAuthApiInternal } from '../../hostapi.v4.internal';
import { createAzureResourcesApiSessionInternal, verifyAzureResourcesApiSessionInternal } from './authApiInternal';

const v4: string = '4.0.0';

export function createAzureResourcesAuthApiFactory(coreApiProvider: apiUtils.AzureExtensionApiProvider): AzureExtensionApiFactory<AzureResourcesAuthApiInternal> {
    const credentialManager: AzExtCredentialManager = new AzExtUUIDCredentialManager();

    return {
        apiVersion: v4,
        createApi: (options?: GetApiOptions) => {
            return {
                apiVersion: v4,
                getAzureResourcesApi: async (clientExtensionId: string, azureResourcesCredential: string, azureResourcesApiVersions: string[]) => {
                    return await callWithTelemetryAndErrorHandling('api.getAzureResourcesApi', async (context: IActionContext) => {
                        setTelemetryAndErrorHandling(context, options?.extensionId);

                        const verified: boolean = await verifyAzureResourcesApiSessionInternal(context, credentialManager, clientExtensionId, azureResourcesCredential);
                        if (!verified) {
                            return [];
                        }

                        return azureResourcesApiVersions
                            .map((apiVersion) => {
                                try {
                                    return coreApiProvider.getApi(apiVersion, options);
                                } catch {
                                    return undefined;
                                }
                            });

                    }) ?? [];
                },
                createAzureResourcesApiSession: async (clientExtensionId: string, clientExtensionVersion: string, clientExtensionCredential: string) => {
                    return await callWithTelemetryAndErrorHandling('api.createAzureResourcesApiSession', async (context: IActionContext) => {
                        setTelemetryAndErrorHandling(context, options?.extensionId);
                        return await createAzureResourcesApiSessionInternal(context, credentialManager, clientExtensionId, clientExtensionVersion, clientExtensionCredential);
                    });
                },
            };
        },
    };
}

function setTelemetryAndErrorHandling(context: IActionContext, extensionId?: string): void {
    context.telemetry.properties.callingExtensionId = extensionId;
    context.telemetry.properties.isActivationEvent = 'true';
    context.telemetry.properties.apiVersion = v4;
    context.errorHandling.rethrow = true;
    context.errorHandling.suppressDisplay = true;
    context.errorHandling.suppressReportIssue = true;
}
