/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as vscode from 'vscode';
import { getHttpUrl } from '../../src/webviews/copilotOnRails/shared/httpUrl';
import { openExternalHttpUrl } from '../../src/webviews/copilotOnRails/extension/utils/openExternalHttpUrl';

suite('Copilot on Rails HTTP URLs', () => {
    const invalidUrls: unknown[] = [
        undefined, null, {}, 42, '',
        'javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,test',
        'vbscript:msgbox(1)', 'command:workbench.action.files.openFolder',
        'file:///tmp/test', '//example.com', '/relative', 'https:example.com',
        'https://', 'https://user:password@example.com', 'https://user@example.com',
        'https://example.com\\@other.example', 'https://example.com/\npath',
        'https://example.com/\u0000path', 'https://example.com/a b',
    ];

    test('rejects unsupported, ambiguous, malformed and credential-bearing URLs', () => {
        for (const value of invalidUrls) {
            assert.strictEqual(getHttpUrl(value), undefined, String(value));
        }
    });

    test('preserves application links, local servers and remote forwarded URLs', () => {
        for (const url of [
            'https://example.com/app?q=a%20b#section',
            'http://localhost:5173',
            'http://127.0.0.1:8080/',
            'http://[::1]:8080/',
            'https://example-5173.app.github.dev',
            'https://app.chinacloudsites.cn',
            'HTTPS://example.com/',
        ]) {
            assert.strictEqual(getHttpUrl(` ${url} `), url);
        }
    });

    test('revalidates privileged external-open requests and warns without opening invalid input', async () => {
        const originalOpen = Object.getOwnPropertyDescriptor(vscode.env, 'openExternal');
        const originalWarning = Object.getOwnPropertyDescriptor(vscode.window, 'showWarningMessage');
        assert.ok(originalOpen);
        assert.ok(originalWarning);
        const opened: vscode.Uri[] = [];
        const warnings: string[] = [];
        Object.defineProperty(vscode.env, 'openExternal', {
            configurable: true,
            value: async (uri: vscode.Uri) => { opened.push(uri); return true; },
        });
        Object.defineProperty(vscode.window, 'showWarningMessage', {
            configurable: true,
            value: async (message: string) => { warnings.push(message); return undefined; },
        });
        try {
            for (const value of invalidUrls) {
                await openExternalHttpUrl(value);
            }
            assert.strictEqual(opened.length, 0);
            assert.strictEqual(warnings.length, invalidUrls.length);

            await openExternalHttpUrl('https://example.com/app');
            assert.strictEqual(opened.length, 1);
            assert.strictEqual(opened[0].toString(), 'https://example.com/app');
            assert.strictEqual(warnings.length, invalidUrls.length);
        } finally {
            Object.defineProperty(vscode.env, 'openExternal', originalOpen);
            Object.defineProperty(vscode.window, 'showWarningMessage', originalWarning);
        }
    });
});
