/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { escapeWebviewInitialData } from '../../src/webviews/copilotOnRails/extension/utils/escapeWebviewInitialData';

suite('escapeWebviewInitialData', () => {
    test('escapes apostrophes only inside the encoded initial data', () => {
        const template = [
            `script-src 'self';`,
            `_initialData: '%7B%22prompt%22%3A%22I'd%20like%20an%20app%22%7D'`,
            `};`,
        ].join('\n');

        const escaped = escapeWebviewInitialData(template);

        assert.strictEqual(
            escaped,
            [
                `script-src 'self';`,
                `_initialData: '%7B%22prompt%22%3A%22I%27d%20like%20an%20app%22%7D'`,
                `};`,
            ].join('\n'),
        );
    });

    test('leaves templates without the shared initial-data marker unchanged', () => {
        const template = '<html><body>No inline configuration</body></html>';
        assert.strictEqual(escapeWebviewInitialData(template), template);
    });
});
