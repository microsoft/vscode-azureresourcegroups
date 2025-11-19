/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { apiUtils, AzureExtensionApiFactory, callWithTelemetryAndErrorHandling, GetApiOptions, IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtCredentialManager } from '../../../api/src/auth/credentialManager/AzExtCredentialManager';
import { AzExtUUIDCredentialManager } from '../../../api/src/auth/credentialManager/AzExtUUIDCredentialManager';
import { AzureResourcesAuthApiInternal } from '../../hostapi.v4.internal';
import { createApiSessionInternal } from './createApiSession/createApiSessionInternal';
import { CreateApiSessionExtensionProvider, CreateApiSessionInternalContext } from './createApiSession/CreateApiSessionInternalContext';
import { getApiVerifyError, verifyApiSessionInternal } from './verifyApiSession/verifyApiSessionInternal';
import { VerifyApiSessionInternalContext } from './verifyApiSession/VerifyApiSessionInternalContext';

const v4: string = '4.0.0';

export type AuthApiFactoryDependencies = {
    /**
     * An optional credential manager used for issuing and verifying Azure Resources API credentials. If none are supplied, a simple UUID credential manager will be used.
     * @test Use this to more easily mock and inspect the behavior of the underlying credential manager.
     */
    credentialManager?: AzExtCredentialManager;
    /**
     * An optional API provider to be used in lieu of the VS Code extension provider `vscode.extension.getExtension()`.
     * This should _NOT_ be defined in production environments.
     * @test Use this to more easily mock and inject custom client extension API exports.
     */
    clientApiProvider?: CreateApiSessionExtensionProvider;
}

export function createAuthApiFactory(coreApiProvider: apiUtils.AzureExtensionApiProvider, customDependencies?: AuthApiFactoryDependencies): AzureExtensionApiFactory<AzureResourcesAuthApiInternal> {
    const credentialManager = customDependencies?.credentialManager ?? new AzExtUUIDCredentialManager();
    const clientApiProvider = customDependencies?.clientApiProvider;

    return {
        apiVersion: v4,
        createApi: (options?: GetApiOptions) => {
            return {
                apiVersion: v4,

                getAzureResourcesApis: async (clientExtensionId: string, azureResourcesCredential: string, azureResourcesApiVersions: string[]) => {
                    return await callWithTelemetryAndErrorHandling('api.getAzureResourcesApis', async (context: IActionContext) => {
                        setTelemetryAndErrorHandling(context, options?.extensionId);

                        const verified: boolean = await verifyApiSessionInternal(Object.assign(context, {
                            credentialManager,
                            clientExtensionId: clientExtensionId?.toLowerCase(),
                            azureResourcesCredential,
                        }) satisfies VerifyApiSessionInternalContext);

                        if (!verified) {
                            throw new Error(getApiVerifyError(clientExtensionId));
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

                        return await createApiSessionInternal(Object.assign(context, {
                            credentialManager,
                            clientExtensionId: clientExtensionId?.toLowerCase(),
                            clientExtensionVersion,
                            clientExtensionCredential,
                            clientApiProvider,
                        }) satisfies CreateApiSessionInternalContext);
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
