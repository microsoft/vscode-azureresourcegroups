/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { AzureAccount, AzureSubscriptionProvider, AzureTenant, NotSignedInError, RefreshSuggestedEvent, TenantIdAndAccount, getConfiguredAzureEnv } from '@microsoft/vscode-azext-azureauth';
import { IActionContext, IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import type * as vscode from 'vscode';
import { signInToTenant } from '../src/commands/accounts/signInToTenant';

suite('signInToTenant', () => {
    test('signs in to selected discovered tenant', async () => {
        const account = createAccount();
        const discoveredTenant: AzureTenant = {
            account,
            tenantId: 'tenantId',
            displayName: 'Tenant',
        };
        let signedInTenant: TenantIdAndAccount | undefined;
        let inputBoxShown = false;

        const context = createTestActionContext({
            showQuickPick: async picks => picks[0],
            showInputBox: async () => {
                inputBoxShown = true;
                return undefined;
            },
        });
        const provider = createTestSubscriptionProvider({
            getAccounts: async () => [account],
            getUnauthenticatedTenantsForAccount: async () => [discoveredTenant],
            signIn: async tenant => {
                signedInTenant = tenant;
                return true;
            },
        });

        await signInToTenant(context, provider);

        assert.strictEqual(signedInTenant, discoveredTenant);
        assert.strictEqual(inputBoxShown, false);
    });

    test('prompts for tenant when no account exists for tenant discovery', async () => {
        let signedInTenantId: string | undefined;
        let quickPickShown = false;

        const context = createTestActionContext({
            showQuickPick: async picks => {
                quickPickShown = true;
                return picks[0];
            },
            showInputBox: async () => 'contoso.onmicrosoft.com',
        });
        const provider = createTestSubscriptionProvider({
            getAccounts: async () => {
                throw new NotSignedInError();
            },
            signIn: async tenant => {
                signedInTenantId = tenant?.tenantId;
                return true;
            },
        });

        await signInToTenant(context, provider);

        assert.strictEqual(signedInTenantId, 'contoso.onmicrosoft.com');
        assert.strictEqual(quickPickShown, false);
    });
});

function createAccount(): AzureAccount {
    return {
        id: 'accountId',
        label: 'Account',
        environment: getConfiguredAzureEnv(),
    };
}

function createTestActionContext(options: {
    showQuickPick: (picks: IAzureQuickPickItem<TenantIdAndAccount>[]) => Promise<IAzureQuickPickItem<TenantIdAndAccount>>;
    showInputBox: () => Promise<string | undefined>;
}): IActionContext {
    return {
        ui: {
            showQuickPick: options.showQuickPick,
            showInputBox: options.showInputBox,
        },
    } as unknown as IActionContext;
}

function createTestSubscriptionProvider(options: {
    getAccounts?: () => Promise<AzureAccount[]>;
    getUnauthenticatedTenantsForAccount?: (account: AzureAccount) => Promise<AzureTenant[]>;
    signIn: (tenant?: TenantIdAndAccount) => Promise<boolean>;
}): AzureSubscriptionProvider {
    return {
        onRefreshSuggested: (() => ({ dispose: () => { /* no-op */ } })) as unknown as vscode.Event<RefreshSuggestedEvent>,
        getAccounts: options.getAccounts ?? (async () => []),
        getUnauthenticatedTenantsForAccount: options.getUnauthenticatedTenantsForAccount ?? (async () => []),
        signIn: options.signIn,
        getAvailableSubscriptions: async () => [],
        getTenantsForAccount: async () => [],
        getSubscriptionsForTenant: async () => [],
    };
}
