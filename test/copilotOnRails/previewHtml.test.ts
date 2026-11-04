/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import * as vscode from 'vscode';
import { isJsonObject } from '../../src/webviews/copilotOnRails/shared/jsonUtils';

suite('preparePreviewHtml in a browser', () => {
    let testDirectory: string;
    let panel: vscode.WebviewPanel;
    let requestId = 0;

    suiteSetup(async function (this: Mocha.Context): Promise<void> {
        this.timeout(30_000);
        testDirectory = await mkdtemp(join(tmpdir(), 'preview-html-'));
        const bundlePath = join(testDirectory, 'preview-test.js');
        await build({
            stdin: {
                resolveDir: resolve(__dirname, '..', '..'),
                contents: `
                    import { preparePreviewHtml } from './src/webviews/copilotOnRails/views/utils/preparePreviewHtml';
                    import { handlePreviewClick } from './src/webviews/copilotOnRails/views/utils/previewNavigation';
                    const api = acquireVsCodeApi();
                    window.addEventListener('message', event => {
                        const { id, html, themeCss, overrides, clickSelector } = event.data;
                        try {
                            const prepared = preparePreviewHtml(html, themeCss, ['dashboard', 'account-settings'], overrides);
                            const iframe = document.createElement('iframe');
                            iframe.setAttribute('sandbox', 'allow-same-origin');
                            iframe.style.height = '120px';
                            iframe.addEventListener('load', async () => {
                                try {
                                const doc = iframe.contentDocument;
                                const urlBeforeClick = doc.URL;
                                const navigationSlugs = [];
                                let clickPrevented;
                                doc.addEventListener('click', clickEvent => {
                                    handlePreviewClick(clickEvent, slug => navigationSlugs.push(slug));
                                    clickPrevented = clickEvent.defaultPrevented;
                                }, true);
                                if (clickSelector) {
                                    doc.querySelector(clickSelector).click();
                                    await new Promise(resolve => setTimeout(resolve, 150));
                                }
                                const elements = [...doc.querySelectorAll('*')];
                                api.postMessage({
                                    id,
                                    clickPrevented,
                                    navigationSlugs,
                                    sameDocument: iframe.contentDocument === doc,
                                    urlBeforeClick,
                                    urlAfterClick: iframe.contentDocument?.URL,
                                    scrollTop: doc.scrollingElement?.scrollTop,
                                    html: prepared,
                                    text: doc.body.textContent,
                                    tags: elements.map(element => element.localName),
                                    dangerousAttributes: elements.flatMap(element => [...element.attributes])
                                        .filter(attr => attr.name.startsWith('on') || ['srcdoc', 'target', 'formaction', 'action', 'ping', 'xlink:href'].includes(attr.name))
                                        .map(attr => attr.name),
                                    links: [...doc.querySelectorAll('a, area')].map(anchor => ({
                                        href: anchor.getAttribute('href'),
                                        slug: anchor.getAttribute('data-preview-nav'),
                                    })),
                                    styles: [...doc.querySelectorAll('style')].map(style => style.textContent),
                                    policies: [...doc.querySelectorAll('meta')].map(meta => ({
                                        httpEquiv: meta.httpEquiv,
                                        content: meta.content,
                                    })),
                                    firstHeadTag: doc.head.firstElementChild?.localName,
                                    bodyColor: iframe.contentWindow.getComputedStyle(doc.body).color,
                                });
                                } catch (error) {
                                    api.postMessage({ id, error: String(error) });
                                } finally {
                                    iframe.remove();
                                }
                            }, { once: true });
                            iframe.srcdoc = prepared;
                            document.body.append(iframe);
                        } catch (error) {
                            api.postMessage({ id, error: String(error) });
                        }
                    });
                    api.postMessage({ ready: true });
                `,
            },
            bundle: true,
            platform: 'browser',
            outfile: bundlePath,
            logLevel: 'silent',
        });
        const folderUri = vscode.Uri.file(testDirectory);
        panel = vscode.window.createWebviewPanel('previewSanitizationTest', 'Preview sanitization test', vscode.ViewColumn.One, {
            enableScripts: true,
            localResourceRoots: [folderUri],
            retainContextWhenHidden: true,
        });
        await new Promise<void>((resolveReady, reject) => {
            const timeout = setTimeout(() => {
                listener.dispose();
                reject(new Error('Preview test webview did not become ready.'));
            }, 20_000);
            const listener = panel.webview.onDidReceiveMessage((message: unknown) => {
                if (isJsonObject(message) && message.ready === true) {
                    clearTimeout(timeout);
                    listener.dispose();
                    resolveReady();
                }
            });
            const scriptUri = panel.webview.asWebviewUri(vscode.Uri.file(bundlePath));
            panel.webview.html = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${panel.webview.cspSource}; frame-src 'self'; style-src 'unsafe-inline';"></head><body><script src="${scriptUri}"></script></body></html>`;
        });
    });

    suiteTeardown(async () => {
        panel?.dispose();
        if (testDirectory) {
            await rm(testDirectory, { recursive: true, force: true });
        }
    });

    test('preserves styling, inline SVG, local anchors and known-page navigation', async () => {
        const result = await render(`
            <!doctype html><HTML><HEAD><TITLE>Dashboard</TITLE>
            <LINK HREF=./theme.css REL=stylesheet>
            </HEAD><BODY>
            <svg class="preview-icon" viewBox="0 0 24 24" stroke="currentColor"><path d="M4 20V4"/></svg>
            <a href="./account-settings.html?tab=profile#name">Account</a>
            <a href=dashboard.htm>Dashboard</a>
            <a href="#details">Details</a><p id="details" style="margin-left: 4px">Static preview</p>
            </BODY></HTML>
        `, ':root { --color-primary: #123456; } body { color: var(--color-primary); }', { '--color-primary': '#abcdef' });

        assert.deepStrictEqual(result.links, [
            { href: '#', slug: 'account-settings' },
            { href: '#', slug: 'dashboard' },
            { href: '#details', slug: null },
        ]);
        assert.strictEqual(result.bodyColor, 'rgb(171, 205, 239)');
        assert.ok(Array.isArray(result.tags) && result.tags.includes('svg') && result.tags.includes('path'));
        assert.ok(typeof result.html === 'string' && result.html.includes('viewBox="0 0 24 24"') && result.html.includes('margin-left: 4px'));
        assert.deepStrictEqual(result.dangerousAttributes, []);
        assert.strictEqual(result.firstHeadTag, 'meta');
        assert.deepStrictEqual(result.policies, [{
            httpEquiv: 'Content-Security-Policy',
            content: "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none';",
        }]);
    });

    test('removes malformed scripts, mixed-case handlers and SVG executable content', async () => {
        for (const payload of [
            '<script>alert(1)</script ><p>Kept</p>',
            '<scr<script>ipt>alert(1)</scr</script>ipt><p>Kept</p>',
            '<img src=x ONERROR="alert(1)" onload=alert(2)><p oNclick=\'alert(3)\'>Kept</p>',
            '<svg onload=alert(1)><script>alert(2)</script><foreignObject><iframe srcdoc="<script>alert(3)</script>"></iframe></foreignObject><animate attributeName="href" values="javascript:alert(4)"/></svg><p>Kept</p>',
            '<p>Kept</p><math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
        ]) {
            const result = await render(payload);
            assert.deepStrictEqual(result.dangerousAttributes, [], payload);
            assert.ok(Array.isArray(result.tags), payload);
            assert.ok(!result.tags.some(tag => ['script', 'iframe', 'foreignobject', 'animate', 'math'].includes(tag)), payload);
            assert.ok(typeof result.text === 'string' && result.text.includes('Kept'), payload);
        }
    });

    test('clicking the unsupported interactive-app footer or a placeholder never navigates the iframe', async () => {
        for (const href of ['../../index.html', '#', 'https://example.invalid']) {
            const result = await render(
                `<p>Preview remains visible</p><a href="${href}"><span id="footer-label">Open the interactive app</span></a>`,
                undefined, {}, '#footer-label',
            );
            assert.strictEqual(result.clickPrevented, true, href);
            assert.strictEqual(result.sameDocument, true, href);
            assert.strictEqual(result.urlAfterClick, result.urlBeforeClick, href);
            assert.deepStrictEqual(result.navigationSlugs, [], href);
            assert.ok(typeof result.text === 'string' && result.text.includes('Preview remains visible'), href);
        }
    });

    test('clicking a known sibling link requests host navigation without loading another document', async () => {
        const result = await render('<a id="sibling" href="account-settings.html">Settings</a>', undefined, {}, '#sibling');
        assert.strictEqual(result.clickPrevented, true);
        assert.strictEqual(result.sameDocument, true);
        assert.deepStrictEqual(result.navigationSlugs, ['account-settings']);
    });

    test('clicking a local fragment scrolls within srcDoc without navigating to the parent webview', async () => {
        const result = await render(
            '<a id="jump" href="#delivery%20details">Details</a><p style="margin-top:1500px" id="delivery details">Delivery details</p>',
            undefined, {}, '#jump',
        );
        assert.strictEqual(result.clickPrevented, true);
        assert.strictEqual(result.sameDocument, true);
        assert.strictEqual(result.urlAfterClick, result.urlBeforeClick);
        assert.ok(typeof result.scrollTop === 'number' && result.scrollTop > 0);
        assert.deepStrictEqual(result.navigationSlugs, []);
    });

    test('missing and malformed fragments remain inert without leaving the preview', async () => {
        for (const href of ['#missing', '#bad%']) {
            const result = await render(`<a id="fragment" href="${href}">Details</a>`, undefined, {}, '#fragment');
            assert.strictEqual(result.clickPrevented, true, href);
            assert.strictEqual(result.sameDocument, true, href);
            assert.strictEqual(result.urlAfterClick, result.urlBeforeClick, href);
        }
    });

    test('non-anchor controls retain their default click behavior', async () => {
        const result = await render('<button id="button">Preview button</button>', undefined, {}, '#button');
        assert.strictEqual(result.clickPrevented, false);
        assert.strictEqual(result.sameDocument, true);
        assert.deepStrictEqual(result.navigationSlugs, []);
    });

    test('neutralizes encoded schemes, unquoted URLs and forged navigation attributes', async () => {
        const links = [
            '<a href="java&#x73;cript:alert(1)">Encoded</a>',
            '<a href="java&#9;script:alert(1)">Whitespace</a>',
            '<a href="data:text/html,test">Data</a>',
            '<a href="vbscript:msgbox(1)">VBScript</a>',
            '<a href=https://example.invalid/account-settings.html target=_top ping=https://example.invalid>External</a>',
            '<a href="../account-settings.html">Traversal</a>',
            '<a href=missing.html>Missing</a>',
            '<a href="#" data-preview-nav="account-settings">Forged</a>',
            '<svg><a xlink:href="javascript:alert(1)" href="https://example.invalid">SVG</a></svg>',
        ];
        const result = await render(links.join(''));
        assert.deepStrictEqual(result.links, links.map(() => ({ href: '#', slug: null })));
        assert.deepStrictEqual(result.dangerousAttributes, []);
    });

    test('blocks author policies, redirects, embedded pages, forms and stylesheet loads', async () => {
        const result = await render(`
            <head><base href="https://example.invalid/">
            <meta http-equiv="refresh" content="0;url=https://example.invalid">
            <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline'">
            <link rel=stylesheet href=https://example.invalid/theme.css>
            <link rel=stylesheet href=./theme.css></head>
            <body><iframe srcdoc="<p>Embedded</p>"></iframe><object data="https://example.invalid"></object>
            <embed src="https://example.invalid"><form action="https://example.invalid" target="_top">
            <button formaction="https://example.invalid" formtarget="_blank">Submit</button></form></body>
        `);
        assert.ok(Array.isArray(result.tags));
        assert.ok(!result.tags.some(tag => ['link', 'base', 'iframe', 'object', 'embed'].includes(tag)));
        assert.deepStrictEqual(result.dangerousAttributes, []);
        assert.ok(Array.isArray(result.policies) && result.policies.length === 1);
        assert.deepStrictEqual(result.styles, []);
    });

    test('keeps hostile theme CSS inside style raw text and rejects palette injection', async () => {
        const themeCss = 'body { color: #123456; } /* </style><img src=x onerror=alert(1)><script>alert(2)</script> */';
        const result = await render('<head><link rel=stylesheet href=theme.css></head><body>Kept</body>', themeCss, {
            '--color-primary': '#abcdef',
            '--color-text': '#000; } </style><img src=x onerror=alert(1)>',
            '--color-accent: red; } </style>': '#ffffff',
        });
        assert.ok(Array.isArray(result.tags) && !result.tags.includes('img') && !result.tags.includes('script'));
        assert.deepStrictEqual(result.dangerousAttributes, []);
        assert.deepStrictEqual(result.styles, [
            themeCss.replaceAll('<', '\\3c '),
            ':root { --color-primary: #abcdef !important; }',
        ]);
        assert.strictEqual(result.bodyColor, 'rgb(18, 52, 86)');
    });

    test('accepts empty and partially written HTML without requiring a theme', async () => {
        for (const html of ['', '<h1>Loading', '<HEAD><link href=theme.css rel=stylesheet></HEAD><BODY><p>Partial']) {
            const result = await render(html);
            assert.deepStrictEqual(result.dangerousAttributes, []);
            assert.deepStrictEqual(result.styles, []);
            assert.ok(Array.isArray(result.tags) && result.tags.includes('html') && result.tags.includes('body'));
        }
    });

    async function render(html: string, themeCss?: string, overrides: Record<string, string> = {}, clickSelector?: string): Promise<Record<string, unknown>> {
        const id = ++requestId;
        return new Promise((resolveResult, reject) => {
            const timeout = setTimeout(() => {
                listener.dispose();
                reject(new Error(`Preview rendering timed out for request ${id}.`));
            }, 8_000);
            const listener = panel.webview.onDidReceiveMessage((message: unknown) => {
                if (isJsonObject(message) && message.id === id) {
                    clearTimeout(timeout);
                    listener.dispose();
                    if (typeof message.error === 'string') {
                        reject(new Error(message.error));
                    } else {
                        resolveResult(message);
                    }
                }
            });
            void panel.webview.postMessage({ id, html, themeCss, overrides, clickSelector });
        });
    }
});
