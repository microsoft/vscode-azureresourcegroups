/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { formatInlineMarkdown } from '../../src/webviews/copilotOnRails/views/utils/formatInlineMarkdown';

suite('formatInlineMarkdown', () => {
    test('formats supported inline Markdown and warning icons', () => {
        assert.strictEqual(
            formatInlineMarkdown(
                ' `code` **bold** *emphasis* [web](https://example.com?a=1&b=2) [plain](http://example.com) [email](mailto:test@example.com) ⚠️ ',
            ),
            '<code>code</code> <strong>bold</strong> <em>emphasis</em> <a href="https://example.com?a=1&amp;b=2" target="_blank" rel="noreferrer">web</a> <a href="http://example.com" target="_blank" rel="noreferrer">plain</a> <a href="mailto:test@example.com" target="_blank" rel="noreferrer">email</a> <span class="codicon codicon-warning warningIcon" aria-hidden="true"></span>',
        );
    });

    test('restores only exact presentational tags', () => {
        assert.strictEqual(
            formatInlineMarkdown(
                '<details><summary>Endpoints</summary><br>GET /health</details>',
            ),
            '<details><summary>Endpoints</summary><br>GET /health</details>',
        );
    });

    test('keeps attribute-bearing presentational tags escaped', () => {
        assert.strictEqual(
            formatInlineMarkdown(
                '<details open><summary class="label">Endpoints</summary><br class="gap"></details>',
            ),
            '&lt;details open&gt;&lt;summary class=&quot;label&quot;&gt;Endpoints</summary>&lt;br class=&quot;gap&quot;&gt;</details>',
        );
    });

    test('renders unsafe link labels without anchors', () => {
        assert.strictEqual(
            formatInlineMarkdown(
                '[script](javascript:alert) [data](data:text/html;base64,PHNjcmlwdD4=) [file](file:///tmp/test) [relative](//example.com)',
            ),
            'script data file relative',
        );
    });

    test('keeps raw executable markup inert', () => {
        assert.strictEqual(
            formatInlineMarkdown(
                '<script>alert(1)</script><img src=x onerror=alert(1)><svg onload=alert(1)>',
            ),
            '&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;&lt;svg onload=alert(1)&gt;',
        );
    });
});
