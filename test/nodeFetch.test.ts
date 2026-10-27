/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createAzExtLogOutputChannel } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
import { ext } from '../src/extensionVariables';
import { createRequest, fetchWithLogging } from '../src/utils/logging/nodeFetch/nodeFetch';

suite('nodeFetch', () => {
    let previousOutputChannel: typeof ext.outputChannel;
    let testOutputChannel: typeof ext.outputChannel;

    suiteSetup(() => {
        previousOutputChannel = ext.outputChannel;
        testOutputChannel = createAzExtLogOutputChannel('Node Fetch Tests');
        ext.outputChannel = testOutputChannel;
    });

    suiteTeardown(() => {
        ext.outputChannel = previousOutputChannel;
        testOutputChannel.dispose();
    });

    test('fetches a request with a body', async () => {
        const originalFetch = globalThis.fetch;
        const url = 'https://example.com';
        globalThis.fetch = async (input, init) => {
            assert.ok(input instanceof Request);
            assert.strictEqual(input.url, url + '/');
            assert.strictEqual(init?.duplex, 'half');
            return new Response();
        };

        try {
            const response = await fetchWithLogging(url, {
                method: 'POST',
                body: '{}',
            });

            assert.strictEqual(response.status, 200);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('creates a request with a streaming body', () => {
        const body = new ReadableStream();

        const request = createRequest('https://example.com', { method: 'POST', body });

        assert.strictEqual(request.duplex, 'half');
    });
});
