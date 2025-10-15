/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureExtensionApi, IActionContext, IParsedError, maskUserInfo, maskValue, parseError } from '@microsoft/vscode-azext-utils';
import { AzExtCredentialManager } from '../../../api/src/auth/AzExtCredentialManager';
import { AzExtSignatureCredentialManager } from '../../../api/src/auth/AzExtSignatureCredentialManager';
import { apiUtils } from '../../../api/src/utils/apiUtils';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';

const allowedExtensionIds = [
    'ms-azuretools.vscode-azurefunctions',
    'ms-azuretools.vscode-azurecontainerapps',
];

const azureResourcesCredentialManager: AzExtCredentialManager<string> = new AzExtSignatureCredentialManager();

export async function createAzureResourcesApiSessionInternal(context: IActionContext, clientExtensionId: string, clientExtensionVersion: string, clientExtensionCredential: string): Promise<void> {
    context.telemetry.properties.clientExtensionId = clientExtensionId;
    context.telemetry.properties.clientExtensionVersion = clientExtensionVersion;

    if (!allowedExtensionIds.includes(clientExtensionId)) {
        const denied: string = localize('createResourcesApiSession.denied', 'Azure Resources API session denied for extension "{0}".', clientExtensionId);
        context.telemetry.properties.createResourcesApiSessionError = denied;
        context.telemetry.properties.allowed = 'false';
        ext.outputChannel.warn(denied);
        throw new Error(denied);
    }

    context.telemetry.properties.allowed = 'true';

    try {
        const clientApi = await getClientExtensionApi(clientExtensionId, clientExtensionVersion);
        await clientApi.receiveAzureResourcesSession?.(await azureResourcesCredentialManager.createCredential(clientExtensionId), clientExtensionCredential);
    } catch (err) {
        const failed: string = localize('createResourcesApiSession.failed', 'Failed to create Azure Resources API session for extension "{0}".', clientExtensionId);
        ext.outputChannel.error(failed);

        const perr: IParsedError = parseError(err);
        const maskCredentials: string[] = azureResourcesCredentialManager.getMaskValues();
        context.telemetry.properties.createResourcesApiSessionError = maskUserInfo(perr.message, maskCredentials);
        ext.outputChannel.error(maskValues(perr.message, maskCredentials));
        throw new Error(failed);
    }
}

export async function verifyAzureResourcesApiSessionInternal(context: IActionContext, clientExtensionId: string, azureResourcesCredential: string): Promise<boolean> {
    if (!clientExtensionId || !azureResourcesCredential) {
        return false;
    }

    context.telemetry.properties.clientExtensionId = clientExtensionId;

    try {
        const { verified } = await azureResourcesCredentialManager.verifyCredential(azureResourcesCredential, clientExtensionId);

        if (!verified) {
            context.telemetry.properties.deniedReason = 'notVerified';
            throw new Error(localize('getAzureResourcesApi.notVerified', 'Provided a credential that failed verification.'));
        }

        if (!allowedExtensionIds.includes(clientExtensionId)) {
            context.telemetry.properties.deniedReason = 'notAllowed';
            throw new Error(localize('getAzureResourcesApi.notAllowed', 'Requesting extension is not on the allow list.'));
        }

        ext.outputChannel.info(localize('getAzureResourcesApi.success', 'Successfully verified extension "{0}".', clientExtensionId));
        return true;

    } catch (err) {
        const failed: string = localize('getAzureResourcesApi.failed', 'Failed to authenticate extension "{0}".', clientExtensionId);
        context.telemetry.properties.deniedReason ||= 'verifyError';
        ext.outputChannel.error(failed);

        const perr: IParsedError = parseError(err);
        const maskCredentials: string[] = azureResourcesCredentialManager.getMaskValues();
        ext.outputChannel.error(maskValues(perr.message, maskCredentials));
        context.telemetry.properties.getAzureResourcesApiError = maskUserInfo(perr.message, maskCredentials);
        return false;
    }
}

export async function getClientExtensionApi(clientExtensionId: string, clientExtensionVersion: string): Promise<AzureExtensionApi> {
    const extensionProvider = await apiUtils.getExtensionExports<apiUtils.AzureExtensionApiProvider>(clientExtensionId);
    if (extensionProvider) {
        return extensionProvider.getApi<AzureExtensionApi>(clientExtensionVersion);
    } else {
        throw new Error(localize('noClientExt', 'Could not find Azure extension API for extension ID "{0}".', clientExtensionId));
    }
}

function maskValues(message: string, valuesToMask: string[]): string {
    for (const value of valuesToMask) {
        message = maskValue(message, value);
    }
    return message;
}
