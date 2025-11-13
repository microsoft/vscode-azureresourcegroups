/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n } from "vscode";
import { AzureResourcesExtensionAuthApi } from "../../extensionApi";
import { apiUtils, AzureExtensionApi } from "../../utils/apiUtils";
import { AzExtCredentialManager } from "../credentialManager/AzExtCredentialManager";
import { AzExtUUIDCredentialManager } from "../credentialManager/AzExtUUIDCredentialManager";
import { AzureResourcesApiRequestContext } from "./AzureResourcesApiRequestContext";
import { AzureResourcesApiRequestErrorCode } from "./apiRequestErrors";

const azureResourcesAuthApiVersion: string = '^4.0.0';
const azureResourcesExtId = 'ms-azuretools.vscode-azureresourcegroups';

export type AzureResourcesApiRequestPrep<T extends AzureExtensionApi> = {
    /**
     * The modified client extension API.  Ensures the required handshake receiver method has been added.
     */
    clientApi: T & Required<Pick<T, 'receiveAzureResourcesApiSession'>>;

    /**
     * Initiates the authentication handshake required to obtain the Azure Resources API.
     */
    requestResourcesApis: () => void;
};

/**
 * Prepares a client extension for the Azure Resources authentication handshake.
 *
 * @param context - Prerequisite configuration and handlers to prepare the request
 * @param clientExtensionApi - The base extension API to be modified
 * @returns The modified client extension API (with the required receiver method added), and a method to initiate the handshake
 */
export function prepareAzureResourcesApiRequest<T extends AzureExtensionApi>(context: AzureResourcesApiRequestContext, clientExtensionApi: T): AzureResourcesApiRequestPrep<T> {
    if (!context.azureResourcesApiVersions.length) {
        throw new Error('You must specify at least one Azure Resources API version.');
    }

    const clientCredentialManager: AzExtCredentialManager = new AzExtUUIDCredentialManager();

    if (!clientExtensionApi.receiveAzureResourcesApiSession) {
        clientExtensionApi.receiveAzureResourcesApiSession = createReceiveAzureResourcesApiSession(context, clientCredentialManager);
    }

    return {
        clientApi: clientExtensionApi as T & Required<Pick<T, 'receiveAzureResourcesApiSession'>>,
        requestResourcesApis: () => void requestAzureResourcesSession(context, clientCredentialManager, clientExtensionApi.apiVersion),
    };
}

async function requestAzureResourcesSession(context: AzureResourcesApiRequestContext, clientCredentialManager: AzExtCredentialManager, clientApiVersion: string): Promise<void> {
    let clientCredential: string;
    try {
        clientCredential = await clientCredentialManager.createCredential(context.clientExtensionId);
    } catch (err) {
        if (err instanceof Error) {
            void context.onApiRequestError?.({ code: AzureResourcesApiRequestErrorCode.ClientFailedCreateCredential, message: clientCredentialManager.maskCredentials(err.message) })
        }
        return;
    }

    try {
        const resourcesApi = await getClientExtensionApi<AzureResourcesExtensionAuthApi>(azureResourcesExtId, azureResourcesAuthApiVersion);
        await resourcesApi.createAzureResourcesApiSession(context.clientExtensionId, clientApiVersion, clientCredential);
    } catch (err) {
        if (err instanceof Error) {
            void context.onApiRequestError?.({ code: AzureResourcesApiRequestErrorCode.HostCreateSessionFailed, message: clientCredentialManager.maskCredentials(err.message) });
        }
        return;
    }
}

function createReceiveAzureResourcesApiSession(context: AzureResourcesApiRequestContext, clientCredentialManager: AzExtCredentialManager): AzureExtensionApi['receiveAzureResourcesApiSession'] {
    return async function (azureResourcesCredential: string, clientCredential: string): Promise<void> {
        if (!azureResourcesCredential || !clientCredential) {
            void context.onApiRequestError?.({ code: AzureResourcesApiRequestErrorCode.ClientReceivedInsufficientCredentials, message: 'Insufficient credentials were provided back to the client.' });
            return;
        }

        try {
            const verified = await clientCredentialManager.verifyCredential(clientCredential, context.clientExtensionId);
            if (!verified) {
                throw new Error('Client credential returned did not pass verification.');
            }
        } catch (err) {
            if (err instanceof Error) {
                void context.onApiRequestError?.({ code: AzureResourcesApiRequestErrorCode.ClientCredentialFailedVerification, message: clientCredentialManager.maskCredentials(err.message) });
            }
            return;
        }

        try {
            const resourcesAuthApi = await getClientExtensionApi<AzureResourcesExtensionAuthApi>(azureResourcesExtId, azureResourcesAuthApiVersion);
            const resourcesApis = await resourcesAuthApi.getAzureResourcesApis(context.clientExtensionId, azureResourcesCredential, context.azureResourcesApiVersions);
            void context.onDidReceiveAzureResourcesApis(resourcesApis);
        } catch (err) {
            if (err instanceof Error) {
                void context.onApiRequestError?.({ code: AzureResourcesApiRequestErrorCode.HostApiProvisioningFailed, message: clientCredentialManager.maskCredentials(err.message) });
            }
            return;
        }
    }
}

async function getClientExtensionApi<T extends AzureExtensionApi>(clientExtensionId: string, clientExtensionVersion: string): Promise<T> {
    const extensionProvider = await apiUtils.getExtensionExports<apiUtils.AzureExtensionApiProvider>(clientExtensionId);
    if (extensionProvider) {
        return extensionProvider.getApi<T>(clientExtensionVersion);
    } else {
        throw new Error(l10n.t('Could not find Azure extension API for extension "{0}".', clientExtensionId));
    }
}
