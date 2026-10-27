/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureAccount, AzureSubscription, AzureSubscriptionProvider, AzureTenant, TenantIdAndAccount } from '@microsoft/vscode-azext-azureauth';
import { createTestActionContext } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
import * as vscode from 'vscode';
import { AzureResourceTreeDataProvider } from '../../src/tree/azure/AzureResourceTreeDataProvider';
import { getSubscriptionsForReveal } from '../../src/utils/subscriptionsForReveal';
import { getCachedTestApi } from '../utils/testApiAccess';
import { api } from './api';
import { MockAzureSubscriptionProvider } from './MockAzureSubscriptionProvider';
import { createMockSubscriptionWithFunctions } from './mockServiceFactory';

suite('Explicit subscription discovery', () => {
    teardown(() => {
        getCachedTestApi().testing.setOverrideAzureSubscriptionProvider(undefined);
        getCachedTestApi().testing.setOverrideAzureServiceFactory(undefined);
    });

    test('tenant eleven resolves directly and remains visible across root reloads', async () => {
        const resources = createMockSubscriptionWithFunctions();
        const provider = new class extends MockAzureSubscriptionProvider {
            public availableReads = 0;
            public tenantReads: string[] = [];

            override async getTenantsForAccount(account: AzureAccount): Promise<AzureTenant[]> {
                return Array.from({ length: 11 }, (_, i) => ({ account, tenantId: `tenant-${i + 1}`, displayName: `Tenant ${i + 1}` }));
            }

            override async getSubscriptionsForTenant(tenant: TenantIdAndAccount): Promise<AzureSubscription[]> {
                this.tenantReads.push(tenant.tenantId);
                return super.getSubscriptionsForTenant(tenant);
            }

            override async getAvailableSubscriptions(
                options?: Parameters<AzureSubscriptionProvider['getAvailableSubscriptions']>[0]
            ): Promise<AzureSubscription[]> {
                this.availableReads++;
                if (options?.filter !== false) {
                    return [];
                }
                const accounts = await this.getAccounts();
                const tenants = await this.getTenantsForAccount(accounts[0]);
                return (await Promise.all(tenants.slice(0, options.maximumTenants ?? 10)
                    .map(tenant => this.getSubscriptionsForTenant(tenant)))).flat();
            }
        }(resources);
        getCachedTestApi().testing.setOverrideAzureSubscriptionProvider(() => provider);
        const tree = api().azureResourceTreeDataProvider as AzureResourceTreeDataProvider;
        const id = await tree.resolveSubscriptionForReveal(await createTestActionContext(),
            resources.sub1.subscriptionId, 'TENANT-11', true);
        assert.ok(id.includes('/tenants/tenant-11/'));
        assert.strictEqual(provider.availableReads, 0, 'Tenant-specific resolution must not run a capped broad scan');
        assert.deepStrictEqual(provider.tenantReads, ['tenant-11']);
        for (let i = 0; i < 2; i++) {
            assert.deepStrictEqual((await tree.getChildren())?.map(item => item.id), [id]);
        }
        assert.ok(provider.tenantReads.every(tenant => tenant === 'tenant-11'));

        const all = await getSubscriptionsForReveal(provider);
        assert.ok(all.subscriptions.some(subscription => subscription.tenantId === 'tenant-11'),
            'Requests without hints must enumerate beyond the browsing limit');
    });

    test('explicit refresh invalidates a remembered filtered-out tenant and removes stale subscription visibility', async () => {
        const resources = createMockSubscriptionWithFunctions();
        const provider = new class extends MockAzureSubscriptionProvider {
            public hasAccess = true;
            private cachedAccess = true;
            public reads: { method: string, noCache?: boolean }[] = [];

            override async getAccounts(
                options?: Parameters<AzureSubscriptionProvider['getAccounts']>[0]
            ): Promise<AzureAccount[]> {
                this.reads.push({ method: 'accounts', noCache: options?.noCache });
                return super.getAccounts();
            }

            override async getTenantsForAccount(
                account: AzureAccount,
                options?: Parameters<AzureSubscriptionProvider['getTenantsForAccount']>[1]
            ): Promise<AzureTenant[]> {
                this.reads.push({ method: 'tenants', noCache: options?.noCache });
                return super.getTenantsForAccount(account);
            }

            override async getSubscriptionsForTenant(
                tenant: TenantIdAndAccount,
                options?: Parameters<AzureSubscriptionProvider['getSubscriptionsForTenant']>[1]
            ): Promise<AzureSubscription[]> {
                this.reads.push({ method: 'subscriptions', noCache: options?.noCache });
                if (options?.noCache) {
                    this.cachedAccess = this.hasAccess;
                }
                return this.cachedAccess ? super.getSubscriptionsForTenant(tenant) : [];
            }

            override async getAvailableSubscriptions(): Promise<AzureSubscription[]> {
                // Normal discovery excludes this tenant and therefore cannot invalidate its subscription cache.
                return [];
            }
        }(resources);
        getCachedTestApi().testing.setOverrideAzureSubscriptionProvider(() => provider);
        const tree = api().azureResourceTreeDataProvider as AzureResourceTreeDataProvider;
        const id = await tree.resolveSubscriptionForReveal(await createTestActionContext(),
            resources.sub1.subscriptionId, 'tenantId', true);
        assert.ok((await tree.getChildren())?.some(item => item.id === id));

        provider.hasAccess = false;
        assert.ok((await tree.getChildren())?.some(item => item.id === id), 'Ordinary reads still use the cached result');
        provider.reads = [];
        await vscode.commands.executeCommand('azureResourceGroups.refreshTree');
        await tree.getChildren();
        for (const method of ['accounts', 'tenants', 'subscriptions']) {
            assert.ok(provider.reads.some(read => read.method === method && read.noCache === true),
                `Refresh must bypass the ${method} cache for the remembered identity`);
        }
        assert.ok(!(await tree.getChildren())?.some(item => item.id === id),
            'The removed subscription must not remain visible from a stale discovery result');
    });
});
