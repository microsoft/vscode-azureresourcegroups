/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureExtensionApi } from '@microsoft/vscode-azext-utils';
import { apiUtils } from 'api/src/utils/apiUtils';
import * as jwt from 'jsonwebtoken';
import { ext } from '../extensionVariables';
import { AzureResourcesApiInternal } from '../hostapi.v2.internal';
import { localize } from '../utils/localize';

const tokenSecret: string = crypto.randomUUID();

const whiteListedExtensionIds = [
    'ms-azuretools.vscode-azurefunctions',
    'ms-azuretools.vscode-azurecontainerapps',
];

// Todo: Improve error handling
// Todo: Add telemetry
export async function createAzExtResourcesSession(clientExtensionId: string, clientExtensionVersion: string, clientExtensionToken: string): Promise<string | void> {
    if (!whiteListedExtensionIds.includes(clientExtensionId)) {
        return 'You shall not pass!';
    }

    const tokenPayload: AzExtTokenPayload = {
        clientExtensionId,
        clientExtensionVersion,
    };
    const azExtResourcesToken: string = jwt.sign(tokenPayload, tokenSecret, {
        issuer: ext.context.extension.id,
        expiresIn: '1d',
    });

    const clientApi = await getClientExtensionApi(clientExtensionId, clientExtensionVersion);
    await clientApi.receiveAzExtResourcesSession?.(azExtResourcesToken, clientExtensionToken);
}

// Todo: Add telemetry
export async function getAzExtResourcesApi(azExtResourcesToken: string): Promise<AzureResourcesApiInternal | undefined> {
    if (!azExtResourcesToken) {
        return undefined;
    }

    try {
        const jwtPayload: string | AzExtTokenPayload = jwt.verify(azExtResourcesToken, tokenSecret, {
            issuer: ext.context.extension.id,
        });

        // Todo: Better error message
        if (typeof jwtPayload === 'string') {
            throw new Error();
        }

        // Todo: should we verify the extension id again?
        return ext.resourcesApiFactoryV2.createApi({ extensionId: jwtPayload.clientExtensionId });

    } catch (err) {
        // Todo: Needs error handling
        // When expired
        // Other
        return undefined;
    }
}

type AzExtTokenPayload = jwt.JwtPayload & {
    clientExtensionId?: string;
    clientExtensionVersion?: string;
};


// Copy from utils, needs to be updated with new function signature
export type AzureExtensionApiV3 = AzureExtensionApi & {
    receiveAzExtResourcesSession?(resourcesToken: string, clientToken: string): void | Promise<void>;
};

// apiUtils copy
export async function getClientExtensionApi(clientExtensionId: string, clientExtensionVersion: string): Promise<AzureExtensionApiV3> {
    const extensionProvider = await apiUtils.getExtensionExports<apiUtils.AzureExtensionApiProvider>(clientExtensionId);
    if (extensionProvider) {
        return extensionProvider.getApi<AzureExtensionApiV3>(clientExtensionVersion);
    } else {
        throw new Error(localize('noClientExt', 'Could not find Azure extension API for extension ID "{0}".', clientExtensionId));
    }
}
