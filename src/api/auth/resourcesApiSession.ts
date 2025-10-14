/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureExtensionApi, IActionContext, IParsedError, maskUserInfo, maskValue, parseError } from '@microsoft/vscode-azext-utils';
import { apiUtils } from 'api/src/utils/apiUtils';
import * as jwt from 'jsonwebtoken';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';

const tokenSecret: string = crypto.randomUUID();

const allowedExtensionIds = [
    'ms-azuretools.vscode-azurefunctions',
    'ms-azuretools.vscode-azurecontainerapps',
];

export async function createAzureResourcesApiSessionInternal(context: IActionContext, clientExtensionId: string, clientExtensionVersion: string, clientExtensionToken: string): Promise<void> {
    ext.outputChannel.info(localize('createResourcesApiSession.start', 'Creating Azure Resources API session for extension "{0}".', clientExtensionId));

    context.telemetry.properties.clientExtensionId = clientExtensionId;
    context.telemetry.properties.clientExtensionVersion = clientExtensionVersion;
    context.telemetry.properties.allowed = 'true';

    if (!allowedExtensionIds.includes(clientExtensionId)) {
        const denied: string = localize('createResourcesApiSession.denied', 'Azure Resources API session denied for extension "{0}".', clientExtensionId);
        context.telemetry.properties.createResourcesApiSessionError = denied;
        context.telemetry.properties.allowed = 'false';
        ext.outputChannel.warn(denied);
        throw new Error(denied);
    }

    try {
        const tokenPayload: AzExtTokenPayload = {
            clientExtensionId,
            clientExtensionVersion,
        };
        const azureResourcesToken: string = jwt.sign(tokenPayload, tokenSecret, {
            issuer: ext.context.extension.id,
            expiresIn: '1d',
        });

        const clientApi = await getClientExtensionApi(clientExtensionId, clientExtensionVersion);
        await clientApi.receiveAzExtResourcesSession?.(azureResourcesToken, clientExtensionToken);

    } catch (err) {
        const failed: string = localize('createResourcesApiSession.failed', 'Failed to create Azure Resources API session for extension "{0}".', clientExtensionId);
        ext.outputChannel.error(failed);

        const perr: IParsedError = parseError(err);
        context.telemetry.properties.createResourcesApiSessionError = maskUserInfo(perr.message, [tokenSecret]);
        ext.outputChannel.error(maskValue(perr.message, tokenSecret));
        throw new Error(failed);
    }
}

type AzExtTokenPayload = jwt.JwtPayload & {
    clientExtensionId?: string;
    clientExtensionVersion?: string;
};

export async function getAzureResourcesApiSessionInternal(context: IActionContext, azureResourcesToken: string): Promise<AzExtTokenPayload> {
    ext.outputChannel.info(localize('getAzureResourcesApi.start', 'Received request for the Azure Resources API.'));

    if (!azureResourcesToken) {
        context.telemetry.properties.deniedReason = 'noToken';
        const denied = localize('getAzureResourcesApi.noToken', 'Token missing for authentication to the Azure Resources API.');
        ext.outputChannel.warn(denied);
        throw new Error(denied);
    }

    try {
        const jwtPayload: string | AzExtTokenPayload = jwt.verify(azureResourcesToken, tokenSecret, {
            issuer: ext.context.extension.id,
        });

        if (typeof jwtPayload === 'string') {
            context.telemetry.properties.deniedReason = 'invalidPayload';
            throw new Error(localize('getAzureResourcesApi.invalidPayload', 'Invalid JWT payload received.'));
        }

        context.telemetry.properties.clientExtensionId = jwtPayload.clientExtensionId;
        context.telemetry.properties.clientExtensionVersion = jwtPayload.clientExtensionVersion;

        if (!allowedExtensionIds.includes(jwtPayload.clientExtensionId ?? '')) {
            context.telemetry.properties.deniedReason = 'notAllowed';
            throw new Error(localize('getAzureResourcesApi.notAllowed', 'Requesting extension "{0}" is not on the allow list.', jwtPayload.clientExtensionId ?? 'unknown'));
        }

        ext.outputChannel.info(localize('getAzureResourcesApi.success', 'Successfully verified extension "{0}".', jwtPayload.clientExtensionId));
        return jwtPayload;

    } catch (err) {
        const failed: string = localize('getAzureResourcesApi.failed', 'Failed to authenticate extension.');
        ext.outputChannel.error(failed);

        const perr: IParsedError = parseError(err);
        ext.outputChannel.error(maskValue(perr.message, tokenSecret));

        context.telemetry.properties.deniedReason ||= 'verifyError';
        context.telemetry.properties.getAzureResourcesApiError = maskUserInfo(perr.message, [tokenSecret]);
        throw new Error(failed);
    }
}

type AzureExtensionApiV3 = AzureExtensionApi & {
    receiveAzExtResourcesSession?(resourcesToken: string, clientToken: string): void | Promise<void>;
};

// Todo: update apiUtils
export async function getClientExtensionApi(clientExtensionId: string, clientExtensionVersion: string): Promise<AzureExtensionApiV3> {
    const extensionProvider = await apiUtils.getExtensionExports<apiUtils.AzureExtensionApiProvider>(clientExtensionId);
    if (extensionProvider) {
        return extensionProvider.getApi<AzureExtensionApiV3>(clientExtensionVersion);
    } else {
        throw new Error(localize('noClientExt', 'Could not find Azure extension API for extension ID "{0}".', clientExtensionId));
    }
}

// Todo: Update utils with new types
// Use container apps to try and connect and set up a handshake
// Clean up api
