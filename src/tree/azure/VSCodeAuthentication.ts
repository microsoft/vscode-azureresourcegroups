/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Environment } from '@azure/ms-rest-azure-env';
import { ISubscriptionContext } from '@microsoft/vscode-azext-utils';
import { AzureSubscription } from '../../../api/src/index';
import { createCredential } from '../../utils/v2/credentialsUtils';

/**
 * Creates a subscription context from an application subscription.
 */
export function createSubscriptionContext(subscription: AzureSubscription): ISubscriptionContext {
    return {
        environment: Environment.AzureCloud,
        isCustomCloud: false,
        subscriptionDisplayName: subscription.name,
        subscriptionId: subscription.subscriptionId,
        subscriptionPath: '',
        tenantId: '',
        userId: '',
        credentials: createCredential(subscription.authentication.getSession),
        createCredentialsForScopes: async (scopes: string[]) => {
            return createCredential(subscription.authentication.getSessionWithScopes.bind(subscription.authentication, scopes));
        }
    };
}
