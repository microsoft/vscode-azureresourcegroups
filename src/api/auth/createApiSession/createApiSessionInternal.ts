/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IParsedError, maskUserInfo, parseError } from "@microsoft/vscode-azext-utils";
import { apiUtils } from "../../../../api/src/utils/apiUtils";
import { azureExtensions } from "../../../azureExtensions";
import { ext } from '../../../extensionVariables';
import { localize } from "../../../utils/localize";
import { CreateApiSessionInternalContext } from './CreateApiSessionInternalContext';

const allowedExtensionIds = new Set(azureExtensions.map(extension => `${extension.publisher.toLowerCase()}.${extension.name.toLowerCase()}`));

export async function createApiSessionInternal(context: CreateApiSessionInternalContext): Promise<void> {
    context.telemetry.properties.clientExtensionId = context.clientExtensionId;
    context.telemetry.properties.clientExtensionVersion = context.clientExtensionVersion;

    if (!allowedExtensionIds.has(context.clientExtensionId)) {
        context.telemetry.properties.allowedExtension = 'false';
        ext.outputChannel.warn(localize('createResourcesApiSession.denied', 'Azure Resources API session denied for extension "{0}".', context.clientExtensionId));
        throw new Error('🧙 No, thank you! We don\'t want any more visitors, well-wishers, or distant relations! 🧝🦶');
    }

    context.telemetry.properties.allowedExtension = 'true';

    try {
        const clientApi = context.extensionApiProvider?.getApi(context.clientExtensionId, context.clientExtensionVersion) ??
            await apiUtils.getAzureExtensionApi(ext.context, context.clientExtensionId, context.clientExtensionVersion);

        const azureResourcesCredential: string = await context.credentialManager.createCredential(context.clientExtensionId);
        await clientApi.receiveAzureResourcesApiSession?.(azureResourcesCredential, context.clientExtensionCredential);
    } catch (err) {
        const failed: string = localize('createResourcesApiSession.failed', 'Failed to create Azure Resources API session for extension "{0}".', context.clientExtensionId);
        ext.outputChannel.error(failed);

        const perr: IParsedError = parseError(err);
        const perrMessage: string = context.credentialManager.maskCredentials(perr.message);
        context.telemetry.properties.createResourcesApiSessionError = maskUserInfo(perrMessage, []);
        ext.outputChannel.error(perrMessage);
        throw new Error(failed);
    }
}
