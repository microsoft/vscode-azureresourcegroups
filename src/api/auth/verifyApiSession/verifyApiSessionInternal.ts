/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n } from 'vscode';
import { ext } from '../../../extensionVariables';
import { VerifyApiSessionInternalContext } from './VerifyApiSessionInternalContext';

export const getApiVerifyError = (clientExtensionId?: string) => `${clientExtensionId || 'Unknown Extension'} - 🧙 YOU SHALL NOT PASS! 🔥`;

export async function verifyApiSessionInternal(context: VerifyApiSessionInternalContext): Promise<boolean> {
    const apiVerifyError: string = getApiVerifyError(context.clientExtensionId);

    if (!context.clientExtensionId || !context.azureResourcesCredential) {
        context.telemetry.properties.deniedReason = 'missingDetails';
        throw new Error(apiVerifyError);
    }

    context.telemetry.properties.clientExtensionId = context.clientExtensionId;

    let verified: boolean | undefined;
    try {
        verified = await context.credentialManager.verifyCredential(context.azureResourcesCredential, context.clientExtensionId);
    } catch { /** Skip; handle below */ }

    if (!verified) {
        context.telemetry.properties.deniedReason = 'failedVerification';
        ext.outputChannel.warn(l10n.t('Extension claiming to be "{0}" provided an access token that failed verification.', context.clientExtensionId));
        throw new Error(apiVerifyError);
    }

    return verified;
}
