/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, IParsedError, maskUserInfo, parseError } from '@microsoft/vscode-azext-utils';
import { l10n } from 'vscode';
import { AzExtCredentialManager } from '../../../api/src/auth/credentialManager/AzExtCredentialManager';
import { apiUtils } from '../../../api/src/utils/apiUtils';
import { azureExtensions } from '../../azureExtensions';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';

const allowedExtensionIds: string[] = Array.from(
    new Set(azureExtensions.map(extension => `${extension.publisher.toLowerCase()}.${extension.name.toLowerCase()}`))
);

export async function createAzureResourcesApiSessionInternal(context: IActionContext, credentialManager: AzExtCredentialManager, clientExtensionId: string, clientExtensionVersion: string, clientExtensionCredential: string): Promise<void> {
    context.telemetry.properties.clientExtensionId = clientExtensionId;
    context.telemetry.properties.clientExtensionVersion = clientExtensionVersion;

    if (!allowedExtensionIds.includes(clientExtensionId)) {
        context.telemetry.properties.allowedExtension = 'false';
        ext.outputChannel.warn(localize('createResourcesApiSession.denied', 'Azure Resources API session denied for extension "{0}".', clientExtensionId));
        throw new Error('🧙 No, thank you! We don\'t want any more visitors, well-wishers, or distant relations! 🧝🦶');
    }

    context.telemetry.properties.allowedExtension = 'true';

    try {
        const clientApi = await apiUtils.getAzureExtensionApi(ext.context, clientExtensionId, clientExtensionVersion);
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

export const getApiVerifyError = (clientExtensionId?: string) => `${clientExtensionId || 'Unknown Extension'} - 🧙 YOU SHALL NOT PASS! 🔥`;

export async function verifyAzureResourcesApiSessionInternal(context: IActionContext, credentialManager: AzExtCredentialManager, clientExtensionId: string, azureResourcesCredential: string): Promise<boolean> {
    const apiVerifyError: string = getApiVerifyError(clientExtensionId);

    if (!clientExtensionId || !azureResourcesCredential) {
        context.telemetry.properties.deniedReason = 'missingDetails';
        throw new Error(apiVerifyError);
    }

    context.telemetry.properties.clientExtensionId = clientExtensionId;

    let verified: boolean | undefined;
    try {
        verified = await credentialManager.verifyCredential(azureResourcesCredential, clientExtensionId);
    } catch { /** Skip; handle below */ }

    if (!verified) {
        context.telemetry.properties.deniedReason = 'failedVerification';
        ext.outputChannel.warn(l10n.t('Extension claiming to be "{0}" provided an access token that failed verification.', clientExtensionId));
        throw new Error(apiVerifyError);
    }

    return verified;
}
