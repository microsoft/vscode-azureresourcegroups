/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { resolveAvailableChatModel, type AvailableChatModel } from '../../src/utils/copilotOnRails/modelSelection';

const models: AvailableChatModel[] = [
    { id: 'gpt-5.3-codex', vendor: 'copilot', family: 'gpt-5.3-codex', version: '5.3', name: 'GPT-5.3-Codex' },
    { id: 'gpt-5.6-sol', vendor: 'copilot', family: 'gpt-5.6-sol', version: '5.6', name: 'GPT-5.6 Sol' },
];

suite('resolveAvailableChatModel', () => {
    test('resolves the exact qualified selection instead of another available model', () => {
        assert.strictEqual(resolveAvailableChatModel('GPT-5.6 Sol (copilot)', models)?.id, 'gpt-5.6-sol');
    });

    test('resolves a canonical runtime model id', () => {
        assert.strictEqual(resolveAvailableChatModel('copilot/gpt-5.6-sol', models)?.name, 'GPT-5.6 Sol');
    });

    test('does not substitute an unavailable selection', () => {
        assert.strictEqual(resolveAvailableChatModel('GPT-5.7 Sol (copilot)', models), undefined);
    });
});
