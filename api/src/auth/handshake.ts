/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n } from "vscode";
import { AzureResourcesExtensionAuthApi } from "../extensionApis";
import { apiUtils, AzureExtensionApi } from "../utils/apiUtils";
import { delay } from "../utils/delay";
import { AzureResourcesApiRequestContext } from "./AzureResourcesApiRequestContext";

const azureResourcesAuthApiVersion: string = '4.0.0';
const azureResourcesExtId = 'ms-azuretools.vscode-azureresourcegroups';

export type PrepareAzureResourcesApiRequestResult<T extends AzureExtensionApi> = {
    /**
     * The modified client extension API.  Ensures the required `receiveAzureResourcesSession` method has been added.
     */
    clientApi: T & Required<Pick<T, 'receiveAzureResourcesSession'>>;
    /**
     * Initiates the authentication handshake required to obtain the Azure Resources API.
     * This process includes polling to ensure that both the Azure Resources extension and the client extension
     * have exported APIs that are ready for use. The polling will continue until the specified maximum wait time is reached.
     *
     * If your extension has a longer activation time, you can specify a custom maximum wait time.
     * It is recommended to call this and immediately export your API to ensure that it is ready within the max wait time allotted.
     *
     * @param maxWaitTimeMs - The maximum time, in milliseconds, to wait for the APIs to become ready before timing out.
     *                        Defaults to 10 seconds (10,000 ms).
     */
    requestResourcesApi: (maxWaitTimeMs?: number) => void;
};

export function prepareAzureResourcesApiRequest<T extends AzureExtensionApi>(context: AzureResourcesApiRequestContext, clientExtensionApi: T): PrepareAzureResourcesApiRequestResult<T> {
    if (!clientExtensionApi.receiveAzureResourcesSession) {
        clientExtensionApi.receiveAzureResourcesSession = createReceiveAzureResourcesSession(context);
    }

    return {
        clientApi: clientExtensionApi as T & Required<Pick<T, 'receiveAzureResourcesSession'>>,
        requestResourcesApi: (maxWaitTimeMs?: number) => void requestAzureResourcesSession(context, clientExtensionApi.apiVersion, maxWaitTimeMs),
    };
}

export async function requestAzureResourcesSession(context: AzureResourcesApiRequestContext, clientApiVersion: string, maxWaitTimeMs: number = 1000 * 10): Promise<void> {
    const areExtensionsReady: boolean = await verifyExtensionsReady(context, clientApiVersion, maxWaitTimeMs /** maxWaitTimeMs */);
    if (!areExtensionsReady) {
        // Log and continue (shouldn't hurt to try anyway)
    }

    const resourcesApi = await getClientExtensionApi<AzureResourcesExtensionAuthApi>(azureResourcesExtId, azureResourcesAuthApiVersion);
    const clientExtensionCredential: string = await context.clientCredentialManager.createCredential(context.clientExtensionId);
    await resourcesApi.createAzureResourcesApiSession(context.clientExtensionId, clientApiVersion, clientExtensionCredential);
}

async function verifyExtensionsReady(context: AzureResourcesApiRequestContext, clientApiVersion: string, maxWaitTimeMs: number): Promise<boolean> {
    const start: number = Date.now();

    while (true) {
        if ((Date.now() - start) > maxWaitTimeMs) {
            break;
        }

        try {
            if (
                await getClientExtensionApi<AzureExtensionApi>(azureResourcesExtId, azureResourcesAuthApiVersion) &&
                await getClientExtensionApi<AzureExtensionApi>(context.clientExtensionId, clientApiVersion)
            ) {
                return true;
            }
        } catch {
            await delay(0);
        }
    }

    return false;
}

function createReceiveAzureResourcesSession(context: AzureResourcesApiRequestContext): AzureExtensionApi['receiveAzureResourcesSession'] {
    return async function (azureResourcesCredential: string, clientCredential: string): Promise<void> {
        if (!azureResourcesCredential || !clientCredential) {
            return;
        }

        const { verified } = await context.clientCredentialManager.verifyCredential(clientCredential, context.clientExtensionId);
        if (!verified) {
            return;
        }

        const resourcesAuthApi = await getClientExtensionApi<AzureResourcesExtensionAuthApi>(azureResourcesExtId, azureResourcesAuthApiVersion);
        const resourcesApis = await resourcesAuthApi.getAzureResourcesApi(context.clientExtensionId, context.azureResourcesApiVersions, azureResourcesCredential) ?? [];
        if (!resourcesApis.length) {
            throw new Error();
        }

        await context.onDidReceiveAzureResourcesApis(resourcesApis);
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
