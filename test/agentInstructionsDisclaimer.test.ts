/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { applyDisclaimer, disclaimerMarker } from '../src/commands/copilotOnRails/agentInstructions';

suite('applyDisclaimer', () => {
    test('inserts the disclaimer after YAML front matter, keeping it parseable', () => {
        const input = ['---', 'name: azure-deploy', 'description: test', '---', '', '# Heading', 'body'].join('\n');
        const output = applyDisclaimer(input);

        assert.ok(output.startsWith('---\n'), 'front matter must remain the first block');
        assert.ok(output.includes('name: azure-deploy'), 'front matter content must be preserved');
        assert.ok(output.includes('# Heading'), 'body content must be preserved');

        const before = output.slice(0, output.indexOf(disclaimerMarker));
        assert.ok(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n\s*$/.test(before), 'the disclaimer must come after a complete front matter block');
    });

    test('inserts the disclaimer at the very top when there is no front matter', () => {
        const output = applyDisclaimer('# Heading\n\nbody\n');
        assert.ok(output.startsWith(disclaimerMarker), 'the disclaimer must be at the very top');
        assert.ok(output.includes('# Heading'), 'body content must be preserved');
    });

    test('is idempotent — re-applying does not add a second disclaimer', () => {
        const once = applyDisclaimer('# Heading\n\nbody\n');
        const twice = applyDisclaimer(once);
        assert.strictEqual(twice, once);
    });

    test('preserves CRLF front matter', () => {
        const input = ['---', 'name: x', '---', '', '# H', 'body'].join('\r\n');
        const output = applyDisclaimer(input);
        assert.ok(output.startsWith('---\r\n'), 'CRLF front matter must remain first');
        const before = output.slice(0, output.indexOf(disclaimerMarker));
        assert.ok(/^---\r\n[\s\S]*?\r\n---[ \t]*\r\n\s*$/.test(before), 'the disclaimer must come after the CRLF front matter block');
    });
});
