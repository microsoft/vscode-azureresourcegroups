/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { createRequest } from '../src/utils/logging/nodeFetch/nodeFetch';

suite('nodeFetch', () => {
    test('creates a request with a streaming body', () => {
        const body = new ReadableStream();

        const request = createRequest('https://example.com', { method: 'POST', body });

        assert.strictEqual(request.duplex, 'half');
    });
});
