/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { AzureAccount, AzureSubscriptionProvider, NotSignedInError, TenantIdAndAccount, getConfiguredAzureEnv } from '@microsoft/vscode-azext-azureauth';
import { IActionContext } from '@microsoft/vscode-azext-utils';
import { signInToTenant } from '../src/commands/accounts/signInToTenant';
import { TenantTreeItem } from '../src/tree/tenants/TenantTreeItem';
import { getConfiguredAzureTenant, getConfiguredTenantFallback, normalizeConfiguredTenant, setConfiguredAzureTenant } from '../src/utils/azureTenantSetting';

suite('signInToTenant', () => {
    teardown(async () => {
        await setConfiguredAzureTenant(undefined);
    });

    test('delegates to the auth package picker when an account is signed in', async () => {
        let delegated = false;
        let inputBoxShown = false;
        let signInCalled = false;

        const context = createTestActionContext({
            showInputBox: async () => {
                inputBoxShown = true;
                return 'should-not-be-used';
            },
        });
        const provider = createTestSubscriptionProvider({
            signIn: async () => {
                signInCalled = true;
                return true;
            },
        });

        await signInToTenant(context, provider, async () => {
            delegated = true;
        });

        assert.strictEqual(delegated, true);
        assert.strictEqual(inputBoxShown, false);
        assert.strictEqual(signInCalled, false);
        assert.strictEqual(getConfiguredAzureTenant(), undefined);
    });

    test('falls back to manual entry and persists the tenant when not signed in', async () => {
        let signedInTenantId: string | undefined;
        let signedInAccount: AzureAccount | undefined;

        const context = createTestActionContext({
            showInputBox: async () => '  contoso.onmicrosoft.com  ',
        });
        const provider = createTestSubscriptionProvider({
            signIn: async tenant => {
                signedInTenantId = tenant?.tenantId;
                signedInAccount = tenant?.account;
                return true;
            },
        });

        await signInToTenant(context, provider, async () => {
            throw new NotSignedInError();
        });

        assert.strictEqual(signedInTenantId, 'contoso.onmicrosoft.com');
        assert.strictEqual(signedInAccount, undefined);
        assert.strictEqual(getConfiguredAzureTenant(), 'contoso.onmicrosoft.com');
    });

    test('does not persist the tenant when the manual sign-in is not completed', async () => {
        const context = createTestActionContext({
            showInputBox: async () => 'contoso.onmicrosoft.com',
        });
        const provider = createTestSubscriptionProvider({
            signIn: async () => false,
        });

        await signInToTenant(context, provider, async () => {
            throw new NotSignedInError();
        });

        assert.strictEqual(getConfiguredAzureTenant(), undefined);
    });

    test('rethrows non sign-in errors without prompting', async () => {
        let inputBoxShown = false;

        const context = createTestActionContext({
            showInputBox: async () => {
                inputBoxShown = true;
                return 'contoso.onmicrosoft.com';
            },
        });
        const provider = createTestSubscriptionProvider({
            signIn: async () => true,
        });

        await assert.rejects(
            signInToTenant(context, provider, async () => {
                throw new Error('boom');
            }),
            /boom/,
        );
        assert.strictEqual(inputBoxShown, false);
        assert.strictEqual(getConfiguredAzureTenant(), undefined);
    });
});

suite('azureTenantSetting', () => {
    teardown(async () => {
        await setConfiguredAzureTenant(undefined);
    });

    test('normalizeConfiguredTenant trims and treats blank as undefined', () => {
        assert.strictEqual(normalizeConfiguredTenant('  contoso  '), 'contoso');
        assert.strictEqual(normalizeConfiguredTenant('   '), undefined);
        assert.strictEqual(normalizeConfiguredTenant(''), undefined);
        assert.strictEqual(normalizeConfiguredTenant(undefined), undefined);
    });

    test('setConfiguredAzureTenant round-trips through configuration', async () => {
        await setConfiguredAzureTenant('  contoso.onmicrosoft.com  ');
        assert.strictEqual(getConfiguredAzureTenant(), 'contoso.onmicrosoft.com');

        await setConfiguredAzureTenant(undefined);
        assert.strictEqual(getConfiguredAzureTenant(), undefined);
    });

    test('getConfiguredTenantFallback injects a synthetic tenant only when configured', () => {
        const account = createAccount();

        assert.deepStrictEqual(getConfiguredTenantFallback(account, 'contoso.onmicrosoft.com'), {
            tenantId: 'contoso.onmicrosoft.com',
            displayName: 'contoso.onmicrosoft.com',
            account,
        });
        assert.strictEqual(getConfiguredTenantFallback(account, '   '), undefined);
        assert.strictEqual(getConfiguredTenantFallback(account, undefined), undefined);
    });

    test('configured tenant fallback renders in the Tenants view without throwing', () => {
        const account = createAccount();
        const fallback = getConfiguredTenantFallback(account, 'contoso.onmicrosoft.com');
        assert.ok(fallback);

        // The Accounts & Tenants view builds a TenantTreeItem for every tenant, and that
        // constructor requires a non-null displayName. A synthetic fallback without one would
        // throw and collapse the whole view to empty.
        assert.doesNotThrow(() => new TenantTreeItem(fallback, account));
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
    showInputBox: () => Promise<string>;
}): IActionContext {
    return {
        ui: {
            showInputBox: options.showInputBox,
        },
    } as unknown as IActionContext;
}

function createTestSubscriptionProvider(options: {
    signIn: (tenant?: Partial<TenantIdAndAccount>) => Promise<boolean>;
}): AzureSubscriptionProvider {
    return {
        signIn: options.signIn,
    } as unknown as AzureSubscriptionProvider;
}
