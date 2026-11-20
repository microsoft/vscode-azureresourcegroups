/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureAccount, AzureSubscription, AzureSubscriptionProvider, AzureTenant, TenantIdAndAccount } from '@microsoft/vscode-azext-azureauth';
import { NotSignedInError } from '@microsoft/vscode-azext-azureauth';
import { createTestActionContext, runWithInputs, UserCancelledError } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
import * as vscode from 'vscode';
import { AzureResourceTreeDataProvider } from '../../src/tree/azure/AzureResourceTreeDataProvider';
import { getCachedTestApi } from '../utils/testApiAccess';
import { api } from './api';
import { MockAzureSubscriptionProvider } from './MockAzureSubscriptionProvider';
import { createMockSubscriptionWithFunctions } from './mockServiceFactory';

async function revealResourceId(...args: Parameters<ReturnType<typeof api>['revealAzureResourceWithResult']>): Promise<string | undefined> {
    return (await api().revealAzureResourceWithResult(...args))?.id;
}

class FilteredSubscriptionProvider extends MockAzureSubscriptionProvider {
    public available: AzureSubscription[] = [];
    public signedIn = true;
    public signInResult = true;
    public signInCalls = 0;
    public signInError?: Error;
    public subscriptionError?: Error;
    public readOptions: Parameters<AzureSubscriptionProvider['getAvailableSubscriptions']>[0][] = [];

    public override async getAvailableSubscriptions(options?: Parameters<AzureSubscriptionProvider['getAvailableSubscriptions']>[0]): Promise<AzureSubscription[]> {
        this.readOptions.push(options);
        if (this.subscriptionError) {
            throw this.subscriptionError;
        }
        if (!this.signedIn) {
            throw new NotSignedInError();
        }
        return options?.filter === false ? this.available : [];
    }

    public override async signIn(): Promise<boolean> {
        this.signInCalls++;
        if (this.signInError) {
            throw this.signInError;
        }
        this.signedIn = this.signInResult;
        return this.signInResult;
    }

    public override async getAccounts(options?: Parameters<AzureSubscriptionProvider['getAccounts']>[0]): Promise<AzureAccount[]> {
        await this.getAvailableSubscriptions({ ...options, filter: false });
        return [...new Map(this.available.map(subscription => [subscription.account.id, subscription.account])).values()];
    }

    public override async getTenantsForAccount(account: AzureAccount): Promise<AzureTenant[]> {
        return this.available.filter(subscription => subscription.account.id === account.id)
            .map(subscription => ({ account, tenantId: subscription.tenantId, displayName: subscription.tenantId }));
    }

    public override async getSubscriptionsForTenant(tenant: TenantIdAndAccount): Promise<AzureSubscription[]> {
        return this.available.filter(subscription =>
            subscription.account.id === tenant.account.id && subscription.tenantId === tenant.tenantId);
    }
}

suite('Explicit Azure resource reveals', () => {
    let provider: FilteredSubscriptionProvider;
    let tree: AzureResourceTreeDataProvider;
    let subscription: AzureSubscription;
    let resourceId: string;

    setup(async () => {
        const resources = createMockSubscriptionWithFunctions();
        resourceId = resources.functionApp1.id;
        provider = new FilteredSubscriptionProvider(resources);
        provider.available = await new MockAzureSubscriptionProvider(resources).getAvailableSubscriptions();
        subscription = provider.available[0];
        getCachedTestApi().testing.setOverrideAzureSubscriptionProvider(() => provider);
        tree = api().azureResourceTreeDataProvider as AzureResourceTreeDataProvider;
    });

    teardown(() => {
        getCachedTestApi().testing.setOverrideAzureSubscriptionProvider(undefined);
    });

    test('only adds the requested hidden subscription and preserves it across refreshes', async () => {
        const configuration = vscode.workspace.getConfiguration('azureResourceGroups');
        const selectedBefore = configuration.get('selectedSubscriptions');
        const context = await createTestActionContext();
        const id = await tree.resolveSubscriptionForReveal(context, subscription.subscriptionId, subscription.tenantId, true);

        assert.strictEqual(id, `/accounts/${subscription.account.id}/tenants/${subscription.tenantId}/subscriptions/${subscription.subscriptionId}`);
        for (let i = 0; i < 2; i++) {
            const roots = await tree.getChildren();
            assert.deepStrictEqual(roots?.map(item => item.id), [id]);
            await vscode.commands.executeCommand('azureResourceGroups.refresh');
        }
        assert.deepStrictEqual(configuration.get('selectedSubscriptions'), selectedBefore);
    });

    test('does not bypass filters unless explicitly requested', async () => {
        const context = await createTestActionContext();
        await tree.resolveSubscriptionForReveal(context, subscription.subscriptionId, subscription.tenantId);
        const roots = await tree.getChildren();
        assert.ok(!roots?.some(item => item.id?.includes(subscription.subscriptionId)));
    });

    test('uses the supplied tenant rather than the first matching subscription', async () => {
        provider.available.unshift({ ...subscription, tenantId: 'another-tenant' });
        const context = await createTestActionContext();
        const id = await tree.resolveSubscriptionForReveal(context, subscription.subscriptionId.toUpperCase(), subscription.tenantId.toUpperCase(), true);
        assert.ok(id.includes(`/tenants/${subscription.tenantId}/`));
        const roots = await tree.getChildren();
        assert.deepStrictEqual(roots?.map(item => item.id), [id]);
    });

    test('reveals only the non-first account and tenant selected in the identity picker', async () => {
        const selectedIdentity: AzureSubscription = {
            ...subscription,
            tenantId: 'selected-tenant',
            account: { ...subscription.account, id: 'selected-account', label: 'Selected account' }
        };
        provider.available = [subscription, selectedIdentity];
        const id = await runWithInputs(
            'internalRevealAzureResourceWithResult',
            ['Selected account'],
            getCachedTestApi().testing.registerOnActionStartHandler,
            () => revealResourceId(`/subscriptions/${subscription.subscriptionId}`, {
                includeFilteredSubscription: true,
                revealOptions: { focus: false, select: false, expand: false }
            })
        );

        assert.strictEqual(id, `/accounts/selected-account/tenants/selected-tenant/subscriptions/${subscription.subscriptionId}`);
        assert.deepStrictEqual((await tree.getChildren())?.map(item => item.id), [id]);
        await vscode.commands.executeCommand('azureResourceGroups.refresh');
        assert.deepStrictEqual((await tree.getChildren())?.map(item => item.id), [id]);
    });

    test('cancelling the identity picker returns undefined without a visibility exception', async () => {
        provider.available = [subscription, {
            ...subscription,
            tenantId: 'other-tenant',
            account: { ...subscription.account, id: 'other-account', label: 'Other account' }
        }];
        const before = (await tree.getChildren())?.map(item => item.id);
        let pickerCalls = 0;
        const disposable = getCachedTestApi().testing.registerOnActionStartHandler(context => {
            if (context.callbackId === 'internalRevealAzureResourceWithResult') {
                context.ui.showQuickPick = async () => {
                    pickerCalls++;
                    throw new UserCancelledError();
                };
            }
        });
        try {
            const id = await revealResourceId(`/subscriptions/${subscription.subscriptionId}`, {
                includeFilteredSubscription: true
            });
            assert.strictEqual(id, undefined);
            assert.strictEqual(pickerCalls, 1);
        } finally {
            disposable.dispose();
        }
        assert.deepStrictEqual((await tree.getChildren())?.map(item => item.id), before);
    });

    test('rejects an unavailable subscription or mismatched tenant', async () => {
        const context = await createTestActionContext();
        await assert.rejects(tree.resolveSubscriptionForReveal(context, 'missing', undefined, true), /subscription is not available/);
        await assert.rejects(tree.resolveSubscriptionForReveal(context, subscription.subscriptionId, 'wrong-tenant', true), /subscription is not available/);
        const roots = await tree.getChildren();
        assert.ok(!roots?.some(item => item.id?.includes(subscription.subscriptionId)));
    });

    test('does not retain subscriptions after their authentication is removed', async () => {
        const context = await createTestActionContext();
        const id = await tree.resolveSubscriptionForReveal(context, subscription.subscriptionId, undefined, true);
        provider.available = [];
        const roots = await tree.getChildren();
        assert.ok(!roots?.some(item => item.id === id));
    });

    test('returns the revealed node ID without relying on selection', async () => {
        const id = await revealResourceId(`/subscriptions/${subscription.subscriptionId}`, {
            tenantId: subscription.tenantId,
            includeFilteredSubscription: true,
            revealOptions: { focus: false, select: false, expand: false }
        });
        assert.strictEqual(id, `/accounts/${subscription.account.id}/tenants/${subscription.tenantId}/subscriptions/${subscription.subscriptionId}`);
        assert.strictEqual(provider.signInCalls, 0);
    });

    test('signs in and resumes the same tenant-specific reveal with fresh subscriptions', async () => {
        provider.signedIn = false;
        const id = await revealResourceId(`/subscriptions/${subscription.subscriptionId}`, {
            tenantId: subscription.tenantId,
            includeFilteredSubscription: true,
            revealOptions: { focus: false, select: false, expand: false }
        });
        assert.strictEqual(id, `/accounts/${subscription.account.id}/tenants/${subscription.tenantId}/subscriptions/${subscription.subscriptionId}`);
        assert.strictEqual(provider.signInCalls, 1);
        assert.ok(provider.readOptions.some(options => options?.filter === false && options.noCache === true));
    });

    test('returns cancellation instead of a missing-node error when sign-in is declined', async () => {
        provider.signedIn = false;
        provider.signInResult = false;
        const id = await revealResourceId(`/subscriptions/${subscription.subscriptionId}`, {
            includeFilteredSubscription: true
        });
        assert.strictEqual(id, undefined);
        assert.strictEqual(provider.signInCalls, 1);
        assert.strictEqual(provider.readOptions.length, 1);
    });

    test('preserves authentication cancellation from VS Code', async () => {
        provider.signedIn = false;
        provider.signInError = new vscode.CancellationError();
        assert.strictEqual(await revealResourceId(`/subscriptions/${subscription.subscriptionId}`), undefined);
        assert.strictEqual(provider.signInCalls, 1);
    });

    test('does not retry unrelated subscription failures with a sign-in prompt', async () => {
        const failure = new Error('Subscription service unavailable');
        provider.subscriptionError = failure;
        const context = await createTestActionContext();
        await assert.rejects(tree.resolveSubscriptionForReveal(context, subscription.subscriptionId), error => error === failure);
        assert.strictEqual(provider.signInCalls, 0);
    });

    test('does not loop when authentication still fails after sign-in', async () => {
        provider.subscriptionError = new NotSignedInError();
        const context = await createTestActionContext();
        await assert.rejects(tree.resolveSubscriptionForReveal(context, subscription.subscriptionId), /not signed in/);
        assert.strictEqual(provider.signInCalls, 1);
        assert.strictEqual(provider.readOptions.length, 2);
    });

    for (const grouping of ['resourceGroup', 'resourceType']) {
        test(`finds qualified resources through ${grouping} grouping`, async () => {
            await vscode.commands.executeCommand(`azureResourceGroups.groupBy.${grouping}`);
            const id = await revealResourceId(resourceId, {
                tenantId: subscription.tenantId,
                includeFilteredSubscription: true,
                revealOptions: { focus: false, select: false, expand: false }
            });
            assert.strictEqual(id, `/accounts/${subscription.account.id}/tenants/${subscription.tenantId}${resourceId}`);
        });
    }

    test('rejects an invalid ID instead of silently succeeding', async () => {
        await assert.rejects(api().revealAzureResourceWithResult('/not-an-azure-resource'), /Azure resource ID/);
    });

    test('rejects missing resources rather than returning a previous selection', async () => {
        await assert.rejects(api().revealAzureResourceWithResult(
            `/subscriptions/${subscription.subscriptionId}/resourceGroups/missing/providers/Microsoft.Web/sites/missing`,
            { includeFilteredSubscription: true }
        ), /could not be found/);
    });
});
