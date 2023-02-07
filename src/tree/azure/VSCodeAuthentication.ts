/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Environment } from '@azure/ms-rest-azure-env';
import { AzExtServiceClientCredentials, ISubscriptionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { AzureSubscription } from '../../../api/src/index';
import { localize } from '../../utils/localize';

/**
 * Converts a VS Code authentication session to an Azure Track 1 & 2 compatible compatible credential.
 */
export function createCredential(getSession: (scopes?: string[]) => vscode.ProviderResult<vscode.AuthenticationSession>): AzExtServiceClientCredentials {
    return {
        getToken: async (scopes?: string | string[]) => {
            if (typeof scopes === 'string') {
                scopes = [scopes];
            }

            const session = await getSession(scopes);

            if (session) {
                return {
                    token: session.accessToken
                };
            } else {
                return null;
            }
        },
        signRequest: async () => {
            throw new Error((localize('signRequestError', 'Track 1 credentials are not (currently) supported.')));
        }
    };
}

/**
 * Creates a subscription context from an application subscription.
 */
export function createSubscriptionContext(subscription: AzureSubscription): ISubscriptionContext {
    return {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        environment: {} as Environment,
        isCustomCloud: false,
        subscriptionDisplayName: subscription.name,
        subscriptionId: subscription.subscriptionId,
        subscriptionPath: '',
        tenantId: '',
        userId: '',
        credentials: createCredential(subscription.authentication.getSession)
    };
}
