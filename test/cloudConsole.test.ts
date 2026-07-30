/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureAccount, AzureSubscriptionProvider, AzureTenant, getConfiguredAzureEnv } from '@microsoft/vscode-azext-azureauth';
import assert from 'assert';
import { getTenantsForSignedInAccounts } from '../src/cloudConsole/cloudConsole';

suite('Cloud Console', () => {
    test('skips accounts that are not signed in when loading tenants', async () => {
        const signedInAccount: AzureAccount = {
            id: 'signed-in',
            label: 'Signed In',
            environment: getConfiguredAzureEnv(),
        };
        const signedOutAccount: AzureAccount = {
            id: 'signed-out',
            label: 'Signed Out',
            environment: getConfiguredAzureEnv(),
        };
        const expectedTenant: AzureTenant = {
            account: signedInAccount,
            displayName: 'Tenant',
            tenantId: 'tenant-id',
        };
        const subscriptionProvider: Pick<AzureSubscriptionProvider, 'getTenantsForAccount'> = {
            getTenantsForAccount: async account => {
                if (account.id === signedOutAccount.id) {
                    throw { isNotSignedInError: true };
                }
                return [expectedTenant];
            },
        };

        const tenants = await getTenantsForSignedInAccounts(subscriptionProvider, [signedInAccount, signedOutAccount]);

        assert.deepStrictEqual(tenants, [expectedTenant]);
    });
});
