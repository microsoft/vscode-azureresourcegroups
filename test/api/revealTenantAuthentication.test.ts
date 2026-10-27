/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureAccount, AzureSubscription, AzureSubscriptionProvider, AzureTenant, NotSignedInError, TenantIdAndAccount } from '@microsoft/vscode-azext-azureauth';
import { runWithInputs, UserCancelledError } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
import * as vscode from 'vscode';
import { AzureResourceTreeDataProvider } from '../../src/tree/azure/AzureResourceTreeDataProvider';
import { getAccountAndTenantPrefix } from '../../src/tree/azure/idPrefix';
import { getCachedTestApi } from '../utils/testApiAccess';
import { api } from './api';
import { MockAzureSubscriptionProvider } from './MockAzureSubscriptionProvider';
import { createMockSubscriptionWithFunctions } from './mockServiceFactory';

const identity = (tenant: TenantIdAndAccount) => `${tenant.account.id}/${tenant.tenantId}`;
const subscriptionTreeId = (subscription: AzureSubscription) =>
    `${getAccountAndTenantPrefix(subscription)}/subscriptions/${subscription.subscriptionId}`;

class TenantAuthenticationProvider extends MockAzureSubscriptionProvider {
    subscriptions: AzureSubscription[] = [];
    visible: AzureSubscription[] = [];
    accountErrors = new Map<string, Error>();
    subscriptionErrors = new Map<string, Error>();
    signIns: (TenantIdAndAccount | undefined)[] = [];
    signInResult = true;
    signInError?: Error;
    clearErrorAfterSignIn = true;
    afterSignIn?: () => void;
    onSubscriptionRead?: (tenant: TenantIdAndAccount) => void;
    reads: { tenant: TenantIdAndAccount, noCache?: boolean }[] = [];

    override async getAccounts(): Promise<AzureAccount[]> {
        return [...new Map(this.subscriptions.map(subscription => [subscription.account.id, subscription.account])).values()];
    }

    override async getTenantsForAccount(account: AzureAccount): Promise<AzureTenant[]> {
        const error = this.accountErrors.get(account.id);
        if (error) {
            throw error;
        }
        return [...new Map(this.subscriptions.filter(subscription => subscription.account.id === account.id)
            .map(subscription => [subscription.tenantId, {
                account, tenantId: subscription.tenantId, displayName: subscription.tenantId
            }])).values()];
    }

    override async getSubscriptionsForTenant(
        tenant: TenantIdAndAccount,
        options?: Parameters<AzureSubscriptionProvider['getSubscriptionsForTenant']>[1]
    ): Promise<AzureSubscription[]> {
        this.reads.push({ tenant, noCache: options?.noCache });
        this.onSubscriptionRead?.(tenant);
        const error = this.subscriptionErrors.get(identity(tenant));
        if (error) {
            throw error;
        }
        return this.subscriptions.filter(subscription => identity(subscription) === identity(tenant));
    }

    override async getAvailableSubscriptions(
        options?: Parameters<AzureSubscriptionProvider['getAvailableSubscriptions']>[0]
    ): Promise<AzureSubscription[]> {
        return (options?.filter === false ? this.subscriptions : this.visible)
            .filter(subscription => !this.accountErrors.has(subscription.account.id)
                && !this.subscriptionErrors.has(identity(subscription)));
    }

    override async signIn(tenant?: TenantIdAndAccount): Promise<boolean> {
        this.signIns.push(tenant);
        if (this.signInError) {
            throw this.signInError;
        }
        if (tenant && this.signInResult && this.clearErrorAfterSignIn) {
            this.accountErrors.delete(tenant.account.id);
            this.subscriptionErrors.delete(identity(tenant));
        }
        this.afterSignIn?.();
        return this.signInResult;
    }
}

suite('Tenant-specific reveal authentication and discovery isolation', () => {
    let provider: TenantAuthenticationProvider;
    let subscription: AzureSubscription;
    let tree: AzureResourceTreeDataProvider;
    let revealOverride: vscode.Disposable;

    setup(async () => {
        const resources = createMockSubscriptionWithFunctions();
        const subscriptions = await new MockAzureSubscriptionProvider(resources).getAvailableSubscriptions();
        subscription = subscriptions[0];
        provider = new TenantAuthenticationProvider(resources);
        provider.subscriptions = [subscription];
        getCachedTestApi().testing.setOverrideAzureSubscriptionProvider(() => provider);
        tree = api().azureResourceTreeDataProvider as AzureResourceTreeDataProvider;
        revealOverride = getCachedTestApi().testing.overrideAzureResourceReveal(async () => { /* accepted by VS Code */ });
    });

    teardown(() => {
        revealOverride.dispose();
        getCachedTestApi().testing.setOverrideAzureSubscriptionProvider(undefined);
        getCachedTestApi().testing.setOverrideAzureServiceFactory(undefined);
    });

    const reveal = (target: AzureSubscription) => api().revealAzureResourceWithResult(
        `/subscriptions/${target.subscriptionId}`,
        { tenantId: target.tenantId, includeFilteredSubscription: true }
    );

    test('signs in an existing account to the hinted tenant and retries that identity with fresh data', async () => {
        provider.subscriptionErrors.set(identity(subscription), new NotSignedInError());
        const result = await reveal(subscription);
        assert.strictEqual(result?.id, subscriptionTreeId(subscription));
        assert.deepStrictEqual(provider.signIns, [{ account: subscription.account, tenantId: subscription.tenantId }]);
        assert.ok(provider.reads.some(read => read.noCache === true && identity(read.tenant) === identity(subscription)));
        await tree.getChildren();
        assert.strictEqual(provider.signIns.length, 1, 'Refresh must not trigger another sign-in');
    });

    for (const cancellation of ['declined', 'user', 'VS Code']) {
        test(`returns undefined when tenant-specific sign-in is ${cancellation}`, async () => {
            provider.subscriptionErrors.set(identity(subscription), new NotSignedInError());
            const before = (await tree.getChildren())?.map(item => item.id);
            if (cancellation === 'declined') {
                provider.signInResult = false;
            } else {
                provider.signInError = cancellation === 'user' ? new UserCancelledError() : new vscode.CancellationError();
            }
            assert.strictEqual(await reveal(subscription), undefined);
            assert.strictEqual(provider.signIns.length, 1);
            assert.deepStrictEqual((await tree.getChildren())?.map(item => item.id), before);
        });
    }

    test('does not repeat tenant sign-in when authentication is still unavailable after the retry', async () => {
        const error = new NotSignedInError();
        provider.subscriptionErrors.set(identity(subscription), error);
        provider.clearErrorAfterSignIn = false;
        await assert.rejects(reveal(subscription), candidate => candidate === error);
        assert.strictEqual(provider.signIns.length, 1);
    });

    test('selects a non-first account needing authentication without switching identities after sign-in', async () => {
        const secondary = { ...subscription, account: { ...subscription.account, id: 'secondary', label: 'Secondary account' } };
        provider.subscriptions.push(secondary);
        provider.subscriptionErrors.set(identity(subscription), new NotSignedInError());
        provider.subscriptionErrors.set(identity(secondary), new NotSignedInError());
        provider.afterSignIn = () => provider.subscriptionErrors.clear();
        const result = await runWithInputs('internalRevealAzureResourceWithResult', ['Secondary account'],
            getCachedTestApi().testing.registerOnActionStartHandler, () => reveal(subscription));
        assert.strictEqual(result?.id, subscriptionTreeId(secondary));
        assert.strictEqual(provider.signIns.length, 1);
        assert.strictEqual(provider.signIns[0]?.account.id, secondary.account.id);
        assert.ok(provider.reads.filter(read => read.noCache).every(read => read.tenant.account.id === secondary.account.id));
        assert.deepStrictEqual((await tree.getChildren())?.map(item => item.id), [subscriptionTreeId(secondary)]);
    });

    test('cancelling the authentication-account picker adds no visibility override or sign-in', async () => {
        const secondary = { ...subscription, account: { ...subscription.account, id: 'secondary', label: 'Secondary account' } };
        provider.subscriptions.push(secondary);
        provider.subscriptionErrors.set(identity(subscription), new NotSignedInError());
        provider.subscriptionErrors.set(identity(secondary), new NotSignedInError());
        const before = (await tree.getChildren())?.map(item => item.id);
        const handler = getCachedTestApi().testing.registerOnActionStartHandler(context => {
            if (context.callbackId === 'internalRevealAzureResourceWithResult') {
                context.ui.showQuickPick = async () => { throw new UserCancelledError(); };
            }
        });
        try {
            assert.strictEqual(await reveal(subscription), undefined);
        } finally {
            handler.dispose();
        }
        assert.strictEqual(provider.signIns.length, 0);
        assert.deepStrictEqual((await tree.getChildren())?.map(item => item.id), before);
    });

    for (const stage of ['tenant enumeration', 'subscription enumeration']) {
        for (const kind of ['authentication', 'service']) {
            test(`a secondary account's ${kind} failure in ${stage} does not block a healthy match`, async () => {
                const secondary = { ...subscription, account: { ...subscription.account, id: 'expired', label: 'Expired account' } };
                provider.subscriptions.unshift(secondary);
                const error = kind === 'authentication' ? new NotSignedInError() : new Error('Secondary discovery failed');
                if (stage === 'tenant enumeration') {
                    provider.accountErrors.set(secondary.account.id, error);
                } else {
                    provider.subscriptionErrors.set(identity(secondary), error);
                }
                assert.strictEqual((await reveal(subscription))?.id, subscriptionTreeId(subscription));
                assert.strictEqual(provider.signIns.length, 0);
            });
        }
    }

    test('propagates a target service failure without prompting for sign-in', async () => {
        const error = new Error('Target tenant service unavailable');
        provider.subscriptionErrors.set(identity(subscription), error);
        await assert.rejects(reveal(subscription), candidate => candidate === error);
        assert.strictEqual(provider.signIns.length, 0);
    });

    for (const relationship of ['another tenant', 'another account in the same tenant']) {
        test(`an unavailable remembered identity in ${relationship} leaves healthy roots and reveals intact`, async () => {
            const healthy = relationship === 'another tenant' ? { ...subscription, tenantId: 'healthy-tenant' }
                : { ...subscription, account: { ...subscription.account, id: 'healthy', label: 'Healthy account' } };
            await reveal(subscription);
            provider.subscriptions.push(healthy);
            provider.visible = [healthy];
            const failure = new Error('Remembered identity unavailable');
            provider.subscriptionErrors.set(identity(subscription), failure);
            const channel = getCachedTestApi().extensionVariables.getOutputChannel();
            const originalAppendLog = channel.appendLog;
            const logs: string[] = [];
            channel.appendLog = message => { logs.push(message); };
            try {
                for (let i = 0; i < 2; i++) {
                    assert.strictEqual((await reveal(healthy))?.id, subscriptionTreeId(healthy));
                    assert.deepStrictEqual((await tree.getChildren())?.map(item => item.id), [subscriptionTreeId(healthy)]);
                }
                assert.ok(logs.some(message => message.includes(failure.message)));
                const targetId = subscriptionTreeId(subscription);
                await assert.rejects(tree.findItemById(targetId, { propagateErrors: true, targetId }),
                    candidate => candidate === failure);
            } finally {
                channel.appendLog = originalAppendLog;
            }
            assert.strictEqual(provider.signIns.length, 0);
        });
    }

    test('a remembered target failure after initial resolution propagates without refresh-time sign-in', async () => {
        const failure = new Error('Visibility lookup failed');
        let reads = 0;
        provider.onSubscriptionRead = tenant => {
            if (identity(tenant) === identity(subscription) && ++reads > 1) {
                provider.subscriptionErrors.set(identity(tenant), failure);
            }
        };
        await assert.rejects(reveal(subscription), candidate => candidate === failure);
        assert.strictEqual(provider.signIns.length, 0);
    });

    test('refresh never signs a remembered tenant back in', async () => {
        const healthy = { ...subscription, tenantId: 'healthy-tenant' };
        provider.subscriptions.push(healthy);
        await reveal(subscription);
        provider.visible = [healthy];
        provider.subscriptionErrors.set(identity(subscription), new NotSignedInError());
        assert.deepStrictEqual((await tree.getChildren())?.map(item => item.id), [subscriptionTreeId(healthy)]);
        assert.strictEqual(provider.signIns.length, 0);
    });
});
