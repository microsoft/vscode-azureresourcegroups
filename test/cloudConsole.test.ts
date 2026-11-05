/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureAccount, AzureSubscriptionProvider, AzureTenant, getConfiguredAzureEnv } from '@microsoft/vscode-azext-azureauth';
import assert from 'assert';
import { connectTerminal, getTenantsForSignedInAccounts, getUserSettings, provisionConsole, resetConsole, type UserSettings } from '../src/cloudConsole/cloudConsole';
import { requireSecureCloudShellUrl } from '../src/cloudConsole/cloudShellUrl';
import { resize } from '../src/cloudConsole/cloudShellChildProcess/cloudConsoleLauncher';
import { createAzExtLogOutputChannel } from '@microsoft/vscode-azext-utils';
import { ext } from '../src/extensionVariables';
import { createServer } from 'http';

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

    test('rejects redirects on authenticated requests while preserving successful Cloud Shell operations', async () => {
        const originalFetch = globalThis.fetch;
        const settings: UserSettings = {
            preferredLocation: 'westus',
            preferredOsType: 'linux',
            storageProfile: {},
            sessionType: 'Ephemeral',
        };
        const consoleUri = 'https://console.custom.example:8443/console';
        const socketUri = 'wss://socket.custom.example/terminal';
        const responses = [
            { properties: settings },
            { properties: { provisioningState: 'Provisioning' } },
            { properties: { provisioningState: 'Succeeded', uri: consoleUri } },
            {},
            { id: 'terminal', socketUri },
            {},
        ];
        const methods: string[] = [];
        globalThis.fetch = async (input, init) => {
            const request = input instanceof Request ? input : new Request(input, init);
            assert.strictEqual(request.redirect, 'error');
            if (request.method === 'GET') {
                assert.strictEqual(request.body, null);
            }

            methods.push(request.method);
            assert.ok(responses.length > 0, 'Unexpected request');

            return new Response(JSON.stringify(responses.shift()), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        };

        try {
            assert.deepStrictEqual(await getUserSettings('test-token'), settings);
            assert.strictEqual(await provisionConsole('test-token', settings, 'linux'), consoleUri);
            await resetConsole('test-token', 'https://management.custom.example');
            const uris = await connectTerminal('test-token', consoleUri, 'bash', { cols: 80, rows: 24 }, () => undefined);
            assert.strictEqual(uris.socketUri, socketUri);
            await resize('test-token', uris.terminalUri);
            assert.deepStrictEqual(methods, ['GET', 'PUT', 'GET', 'DELETE', 'POST', 'POST']);
            assert.strictEqual(responses.length, 0);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('terminal creation and resize never follow an HTTP redirect', async function () {
        this.timeout(20_000);
        const originalFetch = globalThis.fetch;
        let redirectStatus = 302;
        let redirects = 0;
        let redirectedRequests = 0;
        const server = createServer((req, res) => {
            if (req.url === '/redirect') {
                redirects++;
                res.writeHead(redirectStatus, { Location: '/target' });
                res.end();
            } else {
                redirectedRequests++;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ id: 'terminal', socketUri: 'wss://example.com/socket' }));
            }
        });

        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                server.off('error', reject);
                resolve();
            });
        });

        try {
            const address = server.address();
            assert.ok(address && typeof address !== 'string');
            const localUrl = `http://127.0.0.1:${address.port}/redirect`;
            // Replace TLS transport with loopback HTTP, retaining the production request's redirect policy.
            globalThis.fetch = async (input, init) => {
                const request = input instanceof Request ? input : new Request(input, init);
                return originalFetch(localUrl, { method: request.method, headers: request.headers, redirect: request.redirect });
            };

            for (redirectStatus of [301, 302, 303, 307, 308]) {
                await assert.rejects(
                    connectTerminal('test-token', 'https://example.com/console', 'bash', { cols: 80, rows: 24 }, () => undefined),
                    TypeError,
                );
                await assert.rejects(resize('test-token', 'https://example.com/console/terminals/terminal'), TypeError);
            }

            assert.strictEqual(redirects, 10);
            assert.strictEqual(redirectedRequests, 0);
        } finally {
            globalThis.fetch = originalFetch;
            await new Promise<void>((resolve, reject) => {
                server.close(error => error ? reject(error) : resolve());
            });
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
