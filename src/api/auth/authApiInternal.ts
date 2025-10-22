/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureExtensionApi, IActionContext, IParsedError, maskUserInfo, parseError } from '@microsoft/vscode-azext-utils';
import { AzExtCredentialManager } from '../../../api/src/auth/AzExtCredentialManager';
import { apiUtils } from '../../../api/src/utils/apiUtils';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';

const allowedExtensionIds = [
    // Todo: Add remainder of extension ids
    'ms-azuretools.vscode-azurefunctions',
    'ms-azuretools.vscode-azurecontainerapps',
];

export async function createAzureResourcesApiSessionInternal(context: IActionContext, credentialManager: AzExtCredentialManager<unknown>, clientExtensionId: string, clientExtensionVersion: string, clientExtensionCredential: string): Promise<void> {
    context.telemetry.properties.clientExtensionId = clientExtensionId;
    context.telemetry.properties.clientExtensionVersion = clientExtensionVersion;

    if (!allowedExtensionIds.includes(clientExtensionId)) {
        context.telemetry.properties.allowedExtension = 'false';
        ext.outputChannel.warn(localize('createResourcesApiSession.denied', 'Azure Resources API session denied for extension "{0}".', clientExtensionId));
        throw new Error('🧙 No, thank you! We don\'t want any more visitors, well-wishers, or distant relations! 🧝🦶');
    }

    context.telemetry.properties.allowedExtension = 'true';

    try {
        const clientApi = await getClientExtensionApi(clientExtensionId, clientExtensionVersion);
        await clientApi.receiveAzureResourcesApiSession?.(await credentialManager.createCredential(clientExtensionId), clientExtensionCredential);
    } catch (err) {
        const failed: string = localize('createResourcesApiSession.failed', 'Failed to create Azure Resources API session for extension "{0}".', clientExtensionId);
        ext.outputChannel.error(failed);

        const perr: IParsedError = parseError(err);
        const perrMessage: string = credentialManager.maskCredentials(perr.message);
        context.telemetry.properties.createResourcesApiSessionError = maskUserInfo(perrMessage, []);
        ext.outputChannel.error(perrMessage);
        throw new Error(failed);
    }
}

export async function verifyAzureResourcesApiSessionInternal(context: IActionContext, credentialManager: AzExtCredentialManager<unknown>, clientExtensionId: string, azureResourcesCredential: string): Promise<boolean> {
    const getApiVerifyError: string = `${clientExtensionId || 'Unknown Extension'} - 🧙 YOU SHALL NOT PASS! 🔥`;

    if (!clientExtensionId || !azureResourcesCredential) {
        context.telemetry.properties.deniedReason = 'missingDetails';
        throw new Error(getApiVerifyError);
    }

    context.telemetry.properties.clientExtensionId = clientExtensionId;

    try {
        const { verified } = await credentialManager.verifyCredential(azureResourcesCredential, clientExtensionId);

        if (!verified) {
            context.telemetry.properties.deniedReason = 'failedVerification';
            const failedVerification: string = localize('getAzureResourcesApi.failedVerification', 'Extension claiming to be "{0}" provided a credential that failed verification.', clientExtensionId);
            ext.outputChannel.error(failedVerification);
            throw new Error(failedVerification);
        }

        if (!allowedExtensionIds.includes(clientExtensionId)) {
            context.telemetry.properties.deniedReason = 'notAllowed';
            ext.outputChannel.warn(localize('getAzureResourcesApi.notAllowed', 'Extension claiming to be "{0}" is not on the allow list.', clientExtensionId));
            throw new Error(getApiVerifyError);
        }

        ext.outputChannel.info(localize('getAzureResourcesApi.success', 'Successfully verified extension "{0}".', clientExtensionId));
        return true;

    } catch (err) {
        const failed: string = localize('getAzureResourcesApi.verifyError', 'Failed to verify extension "{0}".', clientExtensionId);
        context.telemetry.properties.deniedReason ||= 'verifyError';
        ext.outputChannel.error(failed);

        const perr: IParsedError = parseError(err);
        const perrMessage: string = credentialManager.maskCredentials(perr.message);
        ext.outputChannel.error(perrMessage);
        context.telemetry.properties.getAzureResourcesApiError = maskUserInfo(perrMessage, []);
        throw new Error(perrMessage);
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
