/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureAccount, AzureSubscription, AzureSubscriptionProvider, AzureTenant, TenantIdAndAccount } from '@microsoft/vscode-azext-azureauth';
import { createTestActionContext } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
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
        assert.ok(all.some(subscription => subscription.tenantId === 'tenant-11'),
            'Requests without hints must enumerate beyond the browsing limit');
    });
});
