/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
    AvailableChatModel,
    resolveAvailableChatModel,
} from '../../src/utils/copilotOnRails/modelSelection';

const localModel: AvailableChatModel = {
    id: 'gpt-6.1-sol',
    vendor: 'copilot',
    family: 'gpt-6.1-sol',
    version: '6.1',
    name: 'GPT-6.1 Sol',
};

const cliModel: AvailableChatModel = {
    ...localModel,
    vendor: 'copilotcli',
};

suite('Copilot on Rails model selection', () => {
    test('resolves a qualified local model name', () => {
        assert.strictEqual(
            resolveAvailableChatModel('GPT-6.1 Sol (copilot)', [localModel, cliModel]),
            localModel,
        );
    });

    test('resolves a qualified Copilot CLI model without changing its vendor', () => {
        assert.strictEqual(
            resolveAvailableChatModel('GPT-6.1 Sol (copilotcli)', [localModel, cliModel]),
            cliModel,
        );
    });

    test('does not fabricate a selector for an unavailable model', () => {
        assert.strictEqual(
            resolveAvailableChatModel('Unavailable model', [cliModel]),
            undefined,
        );
    });

    test('resolves an unqualified picker name using the Copilot CLI model id', () => {
        const model = { ...cliModel, id: 'cli-sol' };
        assert.strictEqual(
            resolveAvailableChatModel('GPT-6.1 Sol', [model]),
            model,
        );
    });
});
