/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n, window } from "vscode";
import { AzureResourcesExtensionAuthApi } from "../extensionApis";
import { apiUtils, AzureExtensionApi } from "../utils/apiUtils";
import { delay } from "../utils/delay";
import { AzureResourcesApiRequestContext } from "./AzureResourcesApiRequestContext";
import { AzureResourcesHandshakeErrors } from "./errors";

const azureResourcesAuthApiVersion: string = '4.0.0';
const azureResourcesExtId = 'ms-azuretools.vscode-azureresourcegroups';

export type AzureResourcesApiRequestPrep<T extends AzureExtensionApi> = {
    /**
     * The modified client extension API.  Ensures the required `receiveAzureResourcesSession` method has been added.
     */
    clientApi: T & Required<Pick<T, 'receiveAzureResourcesSession'>>;

    /**
     * Initiates the authentication handshake required to obtain the Azure Resources API.
     * This process includes polling to ensure that both the Azure Resources extension and the client extension
     * have exported APIs that are ready for use. The polling will continue trying until the specified maximum wait time is reached.
     *
     * If your extension has a longer activation time, you can specify a custom maximum wait time.
     * It is recommended to call this and immediately export your API to ensure that it is ready within the max wait time allotted.
     *
     * @param maxWaitTimeMs - The maximum time, in milliseconds, to wait for the APIs to become ready before timing out.
     *                        Defaults to 10 seconds (10,000 ms).
     */
    requestResourcesApi: (maxWaitTimeMs?: number) => void;
};

export function prepareAzureResourcesApiRequest<T extends AzureExtensionApi>(context: AzureResourcesApiRequestContext, clientExtensionApi: T): AzureResourcesApiRequestPrep<T> {
    if (!context.azureResourcesApiVersions.length) {
        throw new Error('You must specify at least one Azure Resources API version.');
    }

    if (!clientExtensionApi.receiveAzureResourcesApiSession) {
        clientExtensionApi.receiveAzureResourcesApiSession = createReceiveAzureResourcesSession(context);
    }

    return {
        clientApi: clientExtensionApi as T & Required<Pick<T, 'receiveAzureResourcesSession'>>,
        requestResourcesApi: (maxWaitTimeMs?: number) => void requestAzureResourcesSession(context, clientExtensionApi.apiVersion, maxWaitTimeMs),
    };
}

async function requestAzureResourcesSession(context: AzureResourcesApiRequestContext, clientApiVersion: string, maxWaitTimeMs: number = 1000 * 10): Promise<void> {
    try {
        const extensionsReady = await verifyExtensionsReady(context, clientApiVersion, maxWaitTimeMs);
        if (!extensionsReady.client) {
            await context.onHandshakeError?.(AzureResourcesHandshakeErrors.CLIENT_EXT_NOT_READY) ??
                void window.showWarningMessage(l10n.t('Client extension "{0}" was not activated in time. Some features may not be available.', context.clientExtensionId));
            return;
        } else if (!extensionsReady.resources) {
            await context.onHandshakeError?.(AzureResourcesHandshakeErrors.HOST_EXT_NOT_READY) ??
                void window.showWarningMessage(l10n.t('Host extension "{0}" was not activated in time. Some features may not be available.', azureResourcesExtId));
            return;
        }

        const resourcesApi = await getClientExtensionApi<AzureResourcesExtensionAuthApi>(azureResourcesExtId, azureResourcesAuthApiVersion);
        const clientExtensionCredential: string = await context.clientCredentialManager.createCredential(context.clientExtensionId);
        await resourcesApi.createAzureResourcesApiSession(context.clientExtensionId, clientApiVersion, clientExtensionCredential);

    } catch (err) {
        if (err instanceof Error) {
            await context.onHandshakeError?.({ code: AzureResourcesHandshakeErrors.UNEXPECTED.code, message: context.clientCredentialManager.maskCredentials(err.message) });
        }
    }
}

function createReceiveAzureResourcesSession(context: AzureResourcesApiRequestContext): AzureExtensionApi['receiveAzureResourcesApiSession'] {
    return async function (azureResourcesCredential: string, clientCredential: string): Promise<void> {
        if (!azureResourcesCredential || !clientCredential) {
            await context.onHandshakeError?.(AzureResourcesHandshakeErrors.INSUFFICIENT_CREDENTIALS);
            return;
        }

        try {
            const { verified } = await context.clientCredentialManager.verifyCredential(clientCredential, context.clientExtensionId);
            if (!verified) {
                throw new Error('Client credential returned did not pass verification.');
            }
        } catch (err) {
            if (err instanceof Error) {
                await context.onHandshakeError?.({ code: AzureResourcesHandshakeErrors.FAILED_VERIFICATION.code, message: context.clientCredentialManager.maskCredentials(err.message) });
            }
            return;
        }

        let resourcesApis: AzureExtensionApi[] | undefined;
        try {
            const resourcesAuthApi = await getClientExtensionApi<AzureResourcesExtensionAuthApi>(azureResourcesExtId, azureResourcesAuthApiVersion);
            resourcesApis = await resourcesAuthApi.getAzureResourcesApi(context.clientExtensionId, context.azureResourcesApiVersions, azureResourcesCredential) ?? [];

            if (!resourcesApis.length) {
                throw new Error('Azure Resources responded with no available APIs.');
            }
        } catch (err) {
            if (err instanceof Error) {
                await context.onHandshakeError?.({ code: AzureResourcesHandshakeErrors.FAILED_GET_API.code, message: err.message });
            }
            return;
        }

        await context.onDidReceiveAzureResourcesApis(resourcesApis);
    }
}

async function verifyExtensionsReady(context: AzureResourcesApiRequestContext, clientApiVersion: string, maxWaitTimeMs: number): Promise<{ client: boolean; resources: boolean }> {
    let client: boolean | undefined;
    let resources: boolean | undefined;

    const start: number = Date.now();
    while (true) {
        if ((Date.now() - start) > maxWaitTimeMs) {
            break;
        }

        try {
            client = !!await getClientExtensionApi<AzureExtensionApi>(context.clientExtensionId, clientApiVersion)
            resources = !!await getClientExtensionApi<AzureExtensionApi>(azureResourcesExtId, azureResourcesAuthApiVersion);

            if (resources && client) {
                return { client, resources };
            }
        } catch {
            await delay(0);
        }
    }

    return { client: !!client, resources: !!resources };
}

async function getClientExtensionApi<T extends AzureExtensionApi>(clientExtensionId: string, clientExtensionVersion: string): Promise<T> {
    const extensionProvider = await apiUtils.getExtensionExports<apiUtils.AzureExtensionApiProvider>(clientExtensionId);
    if (extensionProvider) {
        return extensionProvider.getApi<T>(clientExtensionVersion);
    } else {
        throw new Error(l10n.t('Could not find Azure extension API for extension "{0}".', clientExtensionId));
    }
}
