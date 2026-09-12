/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as vscode from 'vscode';
import { readPreviewPages } from '../../src/webviews/copilotOnRails/extension/utils/previewPagesReader';

suite('readPreviewPages', () => {
    let testDirectory: string;

    setup(async () => {
        testDirectory = await mkdtemp(join(tmpdir(), 'preview-pages-reader-'));
    });

    teardown(async () => {
        await rm(testDirectory, { recursive: true, force: true });
    });

    test('reads valid pages while preserving partial generation', async () => {
        const previewFolder = await writePreviewManifest({
            previewStatus: 'generating',
            pages: [
                { slug: 'dashboard', title: 'Dashboard', route: '/', status: 'pending' },
                { slug: 'account-settings', title: 'Account settings', route: '/settings', status: 'pending' },
            ],
        });
        await writeFile(join(previewFolder.fsPath, 'theme.css'), 'body { color: blue; }');
        await writeFile(join(previewFolder.fsPath, 'dashboard.html'), '<head><link rel="stylesheet" href="theme.css"></head>');

        const result = await readPreviewPages(previewFolder);

        assert.strictEqual(result.previewStatus, 'generating');
        assert.deepStrictEqual(result.pages, [
            {
                slug: 'dashboard',
                title: 'Dashboard',
                route: '/',
                status: 'ready',
                html: '<head><style data-inlined="theme.css">body { color: blue; }</style></head>',
            },
            {
                slug: 'account-settings',
                title: 'Account settings',
                route: '/settings',
                status: 'pending',
            },
        ]);
    });

    test('ignores entries with invalid field types or values', async () => {
        const previewFolder = await writePreviewManifest({
            previewStatus: 'complete',
            pages: [
                null,
                [],
                'dashboard',
                { slug: 42, title: 'Dashboard', route: '/', status: 'pending' },
                { slug: 'missing-title', title: '', route: '/', status: 'pending' },
                { slug: 'invalid-title', title: 42, route: '/', status: 'pending' },
                { slug: 'invalid-route', title: 'Invalid route', route: 42, status: 'pending' },
                { slug: 'empty-route', title: 'Empty route', route: ' ', status: 'pending' },
                { slug: 'invalid-status', title: 'Invalid status', route: '/', status: 'complete' },
                { slug: 'non-string-status', title: 'Invalid status', route: '/', status: false },
                { slug: 'valid-page', title: 'Valid page', route: '/valid', status: 'ready' },
            ],
        });

        const result = await readPreviewPages(previewFolder);

        assert.strictEqual(result.previewStatus, undefined);
        assert.deepStrictEqual(result.pages, [{
            slug: 'valid-page',
            title: 'Valid page',
            route: '/valid',
            status: 'pending',
        }]);
    });

    test('ignores invalid top-level field types', async () => {
        const previewFolder = await writePreviewManifest({
            previewStatus: 42,
            pages: {},
        });

        assert.deepStrictEqual(await readPreviewPages(previewFolder), {
            pages: [],
            previewStatus: undefined,
        });
    });

    test('ignores malformed JSON', async () => {
        const previewFolder = await writeManifestText('{"pages":');

        assert.deepStrictEqual(await readPreviewPages(previewFolder), {
            pages: [],
            previewStatus: undefined,
        });
    });

    test('ignores non-object JSON roots', async () => {
        for (const text of ['null', '[]', '"manifest"', '42', 'true']) {
            const previewFolder = await writeManifestText(text);

            assert.deepStrictEqual(await readPreviewPages(previewFolder), {
                pages: [],
                previewStatus: undefined,
            });
        }
    });

    test('rejects traversal slugs without reading outside the preview folder', async () => {
        const previewFolder = await writePreviewManifest({
            previewStatus: 'ready',
            pages: [{
                slug: '../outside',
                title: 'Outside',
                route: '/outside',
                status: 'ready',
            }],
        });
        await writeFile(join(previewFolder.fsPath, '..', 'outside.html'), '<h1>Workspace content</h1>');

        assert.deepStrictEqual(await readPreviewPages(previewFolder), {
            pages: [],
            previewStatus: 'ready',
        });
    });

    async function writePreviewManifest(manifest: unknown): Promise<vscode.Uri> {
        return writeManifestText(JSON.stringify(manifest));
    }

    async function writeManifestText(text: string): Promise<vscode.Uri> {
        const previewFolderPath = join(testDirectory, '.azure', '.preview-temp');
        await mkdir(previewFolderPath, { recursive: true });
        await writeFile(join(previewFolderPath, 'manifest.json'), text);
        return vscode.Uri.file(previewFolderPath);
    }
});
