/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureAccount, AzureSubscriptionProvider, AzureTenant, getConfiguredAzureEnv } from '@microsoft/vscode-azext-azureauth';
import assert from 'assert';
import { connectTerminal, getTenantsForSignedInAccounts } from '../src/cloudConsole/cloudConsole';
import { requireSecureCloudShellUrl } from '../src/cloudConsole/cloudShellUrl';
import { createAzExtLogOutputChannel } from '@microsoft/vscode-azext-utils';
import { ext } from '../src/extensionVariables';

suite('Cloud Console', () => {
    let previousOutputChannel: typeof ext.outputChannel;
    let testOutputChannel: typeof ext.outputChannel;

    suiteSetup(() => {
        previousOutputChannel = ext.outputChannel;
        testOutputChannel = createAzExtLogOutputChannel('Cloud Console Tests');
        ext.outputChannel = testOutputChannel;
    });

    suiteTeardown(() => {
        ext.outputChannel = previousOutputChannel;
        testOutputChannel.dispose();
    });

    test('preserves service-issued secure endpoints without assuming a public-cloud host suffix', () => {
        for (const host of ['console.azure.com', 'console.azure.us', 'console.azure.cn', 'console.custom.example:8443']) {
            assert.strictEqual(requireSecureCloudShellUrl(`https://${host}/console`, 'https:'), `https://${host}/console`);
            assert.strictEqual(requireSecureCloudShellUrl(`wss://${host}/terminal`, 'wss:'), `wss://${host}/terminal`);
        }
    });

    test('rejects insecure, malformed and credential-bearing service endpoints without echoing them', () => {
        for (const value of [
            undefined, {}, '', '/console', 'http://example.com/console', 'ws://example.com/terminal',
            'https://user:secret@example.com/console', 'https://example.com/console#fragment',
            'file:///tmp/console',
        ]) {
            assert.throws(() => requireSecureCloudShellUrl(value, 'https:'), {
                message: 'Cloud Shell returned an invalid or insecure endpoint URL.',
            });
        }
        assert.throws(() => requireSecureCloudShellUrl('https://example.com/terminal', 'wss:'));
        assert.throws(() => requireSecureCloudShellUrl('wss://example.com/console', 'https:'));
    });

    test('rejects an insecure console before making a bearer-authenticated request', async () => {
        const originalFetch = globalThis.fetch;
        let requests = 0;
        globalThis.fetch = async () => {
            requests++;
            throw new Error('Unexpected request');
        };
        try {
            await assert.rejects(connectTerminal('test-token', 'http://example.com/console', 'bash', { cols: 80, rows: 24 }, () => undefined), {
                message: 'Cloud Shell returned an invalid or insecure endpoint URL.',
            });
            assert.strictEqual(requests, 0);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('validates terminal service responses and preserves valid secure endpoints', async () => {
        const originalFetch = globalThis.fetch;
        let responseBody: unknown = { id: 'terminal', socketUri: 'ws://example.com/socket' };
        globalThis.fetch = async () => new Response(JSON.stringify(responseBody), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
        try {
            await assert.rejects(connectTerminal('test-token', 'https://example.com/console', 'bash', { cols: 80, rows: 24 }, () => undefined));
            for (const id of [undefined, 42, '', '.', '..']) {
                responseBody = { id, socketUri: 'wss://example.com/socket' };
                await assert.rejects(connectTerminal('test-token', 'https://example.com/console', 'bash', { cols: 80, rows: 24 }, () => undefined), {
                    message: 'Cloud Shell returned an invalid terminal identifier.',
                });
            }
            responseBody = { id: '../terminal', socketUri: 'wss://console.azure.cn/socket' };
            const uris = await connectTerminal('test-token', 'https://console.azure.cn/console', 'bash', { cols: 80, rows: 24 }, () => undefined);
            assert.deepStrictEqual(uris, {
                consoleUri: 'https://console.azure.cn/console',
                terminalUri: 'https://console.azure.cn/console/terminals/..%2Fterminal',
                socketUri: 'wss://console.azure.cn/socket',
            });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

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
