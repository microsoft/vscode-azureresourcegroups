/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtServiceClientCredentials, ISubscriptionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { AzureSubscription } from '../../../api/src/index';
import * as vscodeAccount from '../../tree/azure/VSCodeAuthentication';

/**
 * Converts a VS Code authentication session to an Azure Track 2 compatible compatible credential.
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
        }
    };
}

/**
 * Creates a subscription context from an Azure subscription.
 */
export function createSubscriptionContext(subscription: AzureSubscription): ISubscriptionContext {
    if (!subscription.authentication) {
        return vscodeAccount.createSubscriptionContext(subscription);
    }

    return {
        subscriptionDisplayName: subscription.name,
        subscriptionPath: subscription.subscriptionId,
        userId: '',
        ...subscription,
        credentials: createCredential(subscription.authentication.getSession)
    };
}
