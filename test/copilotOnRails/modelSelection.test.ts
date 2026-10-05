/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
    AvailableChatModel,
    DEFAULT_CHAT_MODEL,
    getModelPickerOptions,
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
    test('provides no picker options when the catalog is empty', () => {
        assert.deepStrictEqual(getModelPickerOptions([]), []);
    });

    test('provides no picker options when no models pass the filter', () => {
        const model = { ...cliModel, id: 'haiku', name: 'Claude Haiku 4.5', family: 'haiku' };
        assert.deepStrictEqual(getModelPickerOptions([model]), []);
    });

    test('keeps the normal picker unchanged when supported models are available', () => {
        assert.deepStrictEqual(getModelPickerOptions([cliModel]), [cliModel.name]);
    });

    test('preserves the default selection when reopening after models become available', () => {
        assert.deepStrictEqual(getModelPickerOptions([cliModel], DEFAULT_CHAT_MODEL), [DEFAULT_CHAT_MODEL, cliModel.name]);
    });

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
