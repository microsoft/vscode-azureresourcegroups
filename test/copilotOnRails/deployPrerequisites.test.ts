/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { normalizeDeployPrerequisites } from '../../src/webviews/copilotOnRails/extension/utils/deployPrerequisites';

suite('normalizeDeployPrerequisites', () => {
    test('always returns both catalog tools in order, resolving display names', () => {
        const result = normalizeDeployPrerequisites([
            { id: 'az', installed: true, version: '2.61.0' },
            { id: 'azd', installed: true, version: '1.9.2' },
        ]);

        assert.deepStrictEqual(result, [
            { tool: 'Azure Developer CLI (azd)', installed: true, version: '1.9.2' },
            { tool: 'Azure CLI (az)', installed: true, version: '2.61.0' },
        ]);
    });

    test('fills missing tools as unknown (installed: false, no version)', () => {
        const result = normalizeDeployPrerequisites([{ id: 'azd', installed: true }]);

        assert.deepStrictEqual(result, [
            { tool: 'Azure Developer CLI (azd)', installed: true },
            { tool: 'Azure CLI (az)', installed: false },
        ]);
    });

    test('treats a missing report as unknown when nothing is provided', () => {
        assert.deepStrictEqual(normalizeDeployPrerequisites([]), [
            { tool: 'Azure Developer CLI (azd)', installed: false },
            { tool: 'Azure CLI (az)', installed: false },
        ]);
    });

    test('sanitizes multi-line version output to a short single-line token', () => {
        const result = normalizeDeployPrerequisites([
            { id: 'azd', installed: true, version: 'azd version 1.9.2\n(commit abc123)' },
        ]);

        assert.strictEqual(result[0].version, 'azd version 1.9.2 (commit abc123)');
    });

    test('drops empty versions rather than rendering a blank cell', () => {
        const result = normalizeDeployPrerequisites([{ id: 'az', installed: true, version: '   ' }]);

        assert.strictEqual(result[1].version, undefined);
    });

    test('ignores unknown tool ids', () => {
        const result = normalizeDeployPrerequisites([
            { id: 'docker' as unknown as 'az', installed: true },
        ]);

        assert.deepStrictEqual(result, [
            { tool: 'Azure Developer CLI (azd)', installed: false },
            { tool: 'Azure CLI (az)', installed: false },
        ]);
    });
});
