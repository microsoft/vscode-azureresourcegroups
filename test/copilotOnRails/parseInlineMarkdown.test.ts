/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { parseInlineMarkdown } from '../../src/webviews/copilotOnRails/views/utils/parseInlineMarkdown';

suite('parseInlineMarkdown', () => {
    test('parses supported inline Markdown and warning icons', () => {
        assert.deepStrictEqual(
            parseInlineMarkdown(
                ' `code` **bold** *emphasis* [web](https://example.com?a=1&b=2) [plain](http://example.com) [email](mailto:test@example.com) ⚠️ ',
            ),
            [
                { type: 'code', children: [{ type: 'text', value: 'code' }] },
                { type: 'text', value: ' ' },
                { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
                { type: 'text', value: ' ' },
                { type: 'emphasis', children: [{ type: 'text', value: 'emphasis' }] },
                { type: 'text', value: ' ' },
                {
                    type: 'link',
                    href: 'https://example.com?a=1&b=2',
                    children: [{ type: 'text', value: 'web' }],
                },
                { type: 'text', value: ' ' },
                {
                    type: 'link',
                    href: 'http://example.com',
                    children: [{ type: 'text', value: 'plain' }],
                },
                { type: 'text', value: ' ' },
                {
                    type: 'link',
                    href: 'mailto:test@example.com',
                    children: [{ type: 'text', value: 'email' }],
                },
                { type: 'text', value: ' ' },
                { type: 'warningIcon' },
            ],
        );
    });

    test('parses exact presentational tags into nested nodes', () => {
        assert.deepStrictEqual(
            parseInlineMarkdown(
                '<details><summary>Endpoints</summary><br>GET /health</details>',
            ),
            [
                {
                    type: 'details',
                    children: [
                        {
                            type: 'summary',
                            children: [{ type: 'text', value: 'Endpoints' }],
                        },
                        { type: 'lineBreak' },
                        { type: 'text', value: 'GET /health' },
                    ],
                },
            ],
        );
    });

    test('keeps attribute-bearing presentational tags as text', () => {
        const input =
            '<details open><summary class="label">Endpoints</summary><br class="gap"></details>';
        assert.deepStrictEqual(parseInlineMarkdown(input), [
            { type: 'text', value: input },
        ]);
    });

    test('keeps unsafe link labels without creating link nodes', () => {
        assert.deepStrictEqual(
            parseInlineMarkdown(
                '[script](javascript:alert) [data](data:text/html;base64,PHNjcmlwdD4=) [file](file:///tmp/test) [relative](//example.com)',
            ),
            [{ type: 'text', value: 'script data file relative' }],
        );
    });

    test('keeps raw executable markup as text', () => {
        const input =
            '<script>alert(1)</script><img src=x onerror=alert(1)><svg onload=alert(1)>';
        assert.deepStrictEqual(parseInlineMarkdown(input), [
            { type: 'text', value: input },
        ]);
    });
});
