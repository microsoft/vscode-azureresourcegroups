/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n } from "vscode";
import { AzureResourcesExtensionApi, AzureResourcesExtensionAuthApi } from "../extensionApi";
import { apiUtils, AzureExtensionApi } from "../utils/apiUtils";
import { delay } from "../utils/delay";
import { AzExtCredentialManager } from "./AzExtCredentialManager";

const azureResourcesDefaultApiVersion = '3.0.0';
const azureResourcesExtId = 'ms-azuretools.vscode-azureresourcegroups';

export type AzureResourcesHandshakeContext = {
    azureResourcesApiVersion?: string;
    clientExtensionId: string;
    clientCredentialManager: AzExtCredentialManager<unknown>;
    onDidReceiveAzureResourcesApi: (azureResourcesApi: AzureResourcesExtensionApi) => void | Promise<void>;
};

export function prepareAzureResourcesHandshake(context: AzureResourcesHandshakeContext, clientExtensionApi: AzureExtensionApi): { api: AzureExtensionApi, initiateHandshake: () => void | Promise<void> } {
    if (!clientExtensionApi.receiveAzureResourcesSession) {
        clientExtensionApi.receiveAzureResourcesSession = createReceiveAzureResourcesSession(context);
    }

    return {
        api: clientExtensionApi,
        initiateHandshake: () => requestAzureResourcesSession(context, clientExtensionApi.apiVersion),
    };
}

export async function requestAzureResourcesSession(context: AzureResourcesHandshakeContext, clientApiVersion: string): Promise<void> {
    const areExtensionsReady: boolean = await verifyExtensionsReady(context, clientApiVersion, 1000 * 10 /** maxWaitTimeMs */);
    if (!areExtensionsReady) {
        // Log and continue (shouldn't hurt to try anyway)
    }

    const azureResourcesApiVersion: string = context.azureResourcesApiVersion ?? azureResourcesDefaultApiVersion;
    const resourcesApi = await getClientExtensionApi<AzureResourcesExtensionAuthApi>(azureResourcesExtId, azureResourcesApiVersion);
    const clientExtensionCredential: string = await context.clientCredentialManager.createCredential(context.clientExtensionId);
    await resourcesApi.createAzureResourcesApiSession(context.clientExtensionId, clientApiVersion, clientExtensionCredential);
}

async function verifyExtensionsReady(context: AzureResourcesHandshakeContext, clientApiVersion: string, maxWaitTimeMs: number): Promise<boolean> {
    const start: number = Date.now();

    while (true) {
        if ((Date.now() - start) > maxWaitTimeMs) {
            break;
        }

        try {
            if (
                await getClientExtensionApi<AzureExtensionApi>(azureResourcesExtId, context.azureResourcesApiVersion ?? azureResourcesDefaultApiVersion) &&
                await getClientExtensionApi<AzureExtensionApi>(context.clientExtensionId, clientApiVersion)
            ) {
                return true;
            }
        } catch {
            // Wait briefly and try again
            await delay(500);
        }
    }

    return false;
}

function createReceiveAzureResourcesSession(context: AzureResourcesHandshakeContext): AzureExtensionApi['receiveAzureResourcesSession'] {
    return async function (azureResourcesCredential: string, clientCredential: string): Promise<void> {
        if (!azureResourcesCredential || !clientCredential) {
            return;
        }

        const { verified } = await context.clientCredentialManager.verifyCredential(clientCredential, context.clientExtensionId);
        if (!verified) {
            return;
        }

        const azureResourcesApiVersion: string = context.azureResourcesApiVersion ?? azureResourcesDefaultApiVersion;
        const resourcesAuthApi = await getClientExtensionApi<AzureResourcesExtensionAuthApi>(azureResourcesExtId, azureResourcesApiVersion);
        const resourcesApi = await resourcesAuthApi.getAzureResourcesApi(context.clientExtensionId, azureResourcesCredential);

        if (!resourcesApi) {
            return;
        }

        await context.onDidReceiveAzureResourcesApi(resourcesApi);
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
