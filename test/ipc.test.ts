/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as http from 'http';
import * as path from 'path';
import { createServer, getIPCHandlePath } from '../src/cloudConsole/ipc';

suite('Cloud Shell IPC', () => {
    test('creates a connectable server', async () => {
        const server = await createServer('vscode-cloud-console', (_req, res) => res.end());

        try {
            await new Promise<void>((resolve, reject) => {
                const req = http.request({ socketPath: server.ipcHandlePath, path: '/' }, res => {
                    res.resume();
                    res.on('end', resolve);
                });
                req.on('error', reject);
                req.end();
            });
        } finally {
            server.dispose();
        }
    });

    test('shortens Unix socket paths that exceed the platform limit', function () {
        if (process.platform === 'win32') {
            this.skip();
        }

        const runtimeDir = path.join('/tmp', 'a'.repeat(54));
        const ipcHandlePath = getIPCHandlePath(`vscode-cloud-console-${'a'.repeat(40)}`, runtimeDir);
        const maxSocketPathLength = process.platform === 'darwin' ? 103 : 107;

        assert.ok(Buffer.byteLength(ipcHandlePath) <= maxSocketPathLength);
        assert.strictEqual(path.dirname(ipcHandlePath), runtimeDir);
    });
});
