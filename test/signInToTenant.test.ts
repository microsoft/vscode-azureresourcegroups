/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { AzureAccount, AzureSubscriptionProvider, AzureTenant, NotSignedInError, RefreshSuggestedEvent, TenantIdAndAccount, getConfiguredAzureEnv } from '@microsoft/vscode-azext-azureauth';
import { IActionContext, IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import type * as vscode from 'vscode';
import { signInToTenant } from '../src/commands/accounts/signInToTenant';
import { getManualSignInTenant, resetManualSignInTenantForTests, setManualSignInTenant } from '../src/utils/manualSignInTenant';

suite('signInToTenant', () => {
    setup(async () => {
        await resetManualSignInTenantForTests();
    });

    teardown(async () => {
        await resetManualSignInTenantForTests();
    });

    test('signs in to selected discovered tenant', async () => {
        const account = createAccount();
        const discoveredTenant: AzureTenant = {
            account,
            tenantId: 'tenantId',
            displayName: 'Tenant',
        };
        let signedInTenant: Partial<TenantIdAndAccount> | undefined;
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
        let signedInTenantAccount: AzureAccount | undefined;
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
                signedInTenantAccount = tenant?.account;
                return true;
            },
        });

        await signInToTenant(context, provider);

        assert.strictEqual(signedInTenantId, 'contoso.onmicrosoft.com');
        assert.strictEqual(signedInTenantAccount, undefined);
        assert.strictEqual(quickPickShown, false);
        assert.strictEqual(getManualSignInTenant(), 'contoso.onmicrosoft.com');
    });

    test('uses tenant domain as quick pick label when display name is missing', async () => {
        const account = createAccount();
        const discoveredTenant: AzureTenant = {
            account,
            tenantId: 'tenantId',
            defaultDomain: 'contoso.onmicrosoft.com',
        };
        let shownLabel: string | undefined;

        const context = createTestActionContext({
            showQuickPick: async picks => {
                shownLabel = picks[0].label;
                return picks[0];
            },
            showInputBox: async () => undefined,
        });
        const provider = createTestSubscriptionProvider({
            getAccounts: async () => [account],
            getUnauthenticatedTenantsForAccount: async () => [discoveredTenant],
            signIn: async () => true,
        });

        await signInToTenant(context, provider);

        assert.strictEqual(shownLabel, 'contoso.onmicrosoft.com');
    });

    test('uses tenant id as quick pick label when display name and domain are missing', async () => {
        const account = createAccount();
        const discoveredTenant: AzureTenant = {
            account,
            tenantId: 'tenantId',
        };
        let shownLabel: string | undefined;

        const context = createTestActionContext({
            showQuickPick: async picks => {
                shownLabel = picks[0].label;
                return picks[0];
            },
            showInputBox: async () => undefined,
        });
        const provider = createTestSubscriptionProvider({
            getAccounts: async () => [account],
            getUnauthenticatedTenantsForAccount: async () => [discoveredTenant],
            signIn: async () => true,
        });

        await signInToTenant(context, provider);

        assert.strictEqual(shownLabel, 'tenantId');
    });

    test('resetManualSignInTenantForTests clears persisted tenant', async () => {
        await setManualSignInTenant('contoso.onmicrosoft.com');

        await resetManualSignInTenantForTests();

        assert.strictEqual(getManualSignInTenant(), undefined);
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
    signIn: (tenant?: Partial<TenantIdAndAccount>) => Promise<boolean>;
}): AzureSubscriptionProvider {
    const onRefreshSuggested: vscode.Event<RefreshSuggestedEvent> = (_listener, _thisArgs, _disposables) => ({ dispose: () => { /* no-op */ } });

    return {
        onRefreshSuggested,
        getAccounts: options.getAccounts ?? (async () => []),
        getUnauthenticatedTenantsForAccount: options.getUnauthenticatedTenantsForAccount ?? (async () => []),
        signIn: options.signIn,
        getAvailableSubscriptions: async () => [],
        getTenantsForAccount: async () => [],
        getSubscriptionsForTenant: async () => [],
    };
}
