/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type { AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import * as vscode from 'vscode';
import { logIn } from '../src/commands/accounts/logIn';
import { ext } from '../src/extensionVariables';
import { addConfiguredTenantScope, normalizeConfiguredTenant } from '../src/utils/azureTenantSetting';

suite('azureTenantSetting', () => {
    test('normalizeConfiguredTenant returns undefined for blank tenants', () => {
        assert.strictEqual(normalizeConfiguredTenant(undefined), undefined);
        assert.strictEqual(normalizeConfiguredTenant(''), undefined);
        assert.strictEqual(normalizeConfiguredTenant('   '), undefined);
    });

    test('normalizeConfiguredTenant trims configured tenants', () => {
        assert.strictEqual(normalizeConfiguredTenant('  contoso.onmicrosoft.com  '), 'contoso.onmicrosoft.com');
    });

    test('addConfiguredTenantScope appends VSCODE_TENANT scope when tenant is configured', () => {
        assert.deepStrictEqual(
            addConfiguredTenantScope(['https://management.azure.com/.default'], 'contoso.onmicrosoft.com'),
            ['https://management.azure.com/.default', 'VSCODE_TENANT:contoso.onmicrosoft.com']
        );
    });

    test('addConfiguredTenantScope leaves scopes unchanged when tenant is not configured', () => {
        assert.deepStrictEqual(
            addConfiguredTenantScope(['https://management.azure.com/.default'], '   '),
            ['https://management.azure.com/.default']
        );
    });

    test('addConfiguredTenantScope does not duplicate tenant scope', () => {
        assert.deepStrictEqual(
            addConfiguredTenantScope(
                ['https://management.azure.com/.default', 'VSCODE_TENANT:contoso.onmicrosoft.com'],
                'contoso.onmicrosoft.com'
            ),
            ['https://management.azure.com/.default', 'VSCODE_TENANT:contoso.onmicrosoft.com']
        );
    });

    test('logIn passes configured azure.tenant to subscription provider signIn', async () => {
        const originalSubscriptionProviderFactory = ext.subscriptionProviderFactory;
        const originalRefreshAzureTree = ext.actions.refreshAzureTree;
        const originalRefreshTenantTree = ext.actions.refreshTenantTree;
        const originalRefreshFocusTree = ext.actions.refreshFocusTree;

        let signedInTenantId: string | undefined;
        const provider = {
            signIn: async (tenant?: { tenantId: string }): Promise<boolean> => {
                signedInTenantId = tenant?.tenantId;
                return true;
            },
        } as AzureSubscriptionProvider;

        try {
            ext.subscriptionProviderFactory = async () => provider;
            ext.actions.refreshAzureTree = () => { /* no-op */ };
            ext.actions.refreshTenantTree = () => { /* no-op */ };
            ext.actions.refreshFocusTree = () => { /* no-op */ };

            await vscode.workspace.getConfiguration().update('azure.tenant', 'contoso.onmicrosoft.com', vscode.ConfigurationTarget.Global);

            await logIn({} as never);

            assert.strictEqual(signedInTenantId, 'contoso.onmicrosoft.com');
        } finally {
            await vscode.workspace.getConfiguration().update('azure.tenant', undefined, vscode.ConfigurationTarget.Global);
            ext.subscriptionProviderFactory = originalSubscriptionProviderFactory;
            ext.actions.refreshAzureTree = originalRefreshAzureTree;
            ext.actions.refreshTenantTree = originalRefreshTenantTree;
            ext.actions.refreshFocusTree = originalRefreshFocusTree;
        }
    });
});
