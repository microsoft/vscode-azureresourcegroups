/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
    AvailableChatModel,
    AUTO_CHAT_MODEL,
    DEFAULT_CHAT_MODEL,
    getDefaultOpusModelOption,
    getModelPickerOptions,
    getSupportedModelOptions,
    resolveAvailableChatModel,
    resolveCopilotHarnessModelSelector,
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
    test('resolves explicit Auto without needing the CLI catalog to advertise it', () => {
        assert.deepStrictEqual(
            resolveCopilotHarnessModelSelector(AUTO_CHAT_MODEL, []),
            { id: 'auto', vendor: 'agent-host-copilotcli' },
        );
    });

    test('does not treat Auto family metadata as a supported named model', () => {
        const auto = { ...cliModel, id: 'auto', name: AUTO_CHAT_MODEL, family: 'claude-opus-4.6' };
        assert.deepStrictEqual(getSupportedModelOptions([auto, cliModel]), [cliModel.name]);
        assert.deepStrictEqual(getModelPickerOptions([auto]), []);
        assert.strictEqual(getDefaultOpusModelOption([auto, cliModel]), undefined);
    });

    test('offers Auto once and keeps a named model first regardless of the CLI Auto flag', () => {
        const auto = { ...cliModel, id: 'auto', name: AUTO_CHAT_MODEL, family: 'claude-sonnet-5' };
        assert.deepStrictEqual(getModelPickerOptions([cliModel]), [cliModel.name, AUTO_CHAT_MODEL]);
        assert.deepStrictEqual(getModelPickerOptions([auto, cliModel]), [cliModel.name, AUTO_CHAT_MODEL]);
        assert.deepStrictEqual(getModelPickerOptions([cliModel], AUTO_CHAT_MODEL), [cliModel.name, AUTO_CHAT_MODEL]);
    });

    test('maps a discovered CLI model id to the Agent Host launch vendor', () => {
        assert.deepStrictEqual(
            resolveCopilotHarnessModelSelector('GPT-6.1 Sol', [cliModel]),
            { id: 'gpt-6.1-sol', vendor: 'agent-host-copilotcli' },
        );
    });

    test('does not resolve an unavailable model to a fallback selector', () => {
        assert.strictEqual(resolveCopilotHarnessModelSelector('Unavailable model', [cliModel]), undefined);
    });

    test('omits a selector for the default sentinel even if a provider lists that id', () => {
        assert.strictEqual(
            resolveCopilotHarnessModelSelector(DEFAULT_CHAT_MODEL, [{ ...cliModel, id: DEFAULT_CHAT_MODEL }]),
            undefined,
        );
    });

    test('provides no picker options when the catalog is empty', () => {
        assert.deepStrictEqual(getModelPickerOptions([]), []);
    });

    test('provides no picker options when no models pass the filter', () => {
        const model = { ...cliModel, id: 'haiku', name: 'Claude Haiku 4.5', family: 'haiku' };
        assert.deepStrictEqual(getModelPickerOptions([model]), []);
    });

    test('keeps supported models available alongside explicit Auto', () => {
        assert.deepStrictEqual(getModelPickerOptions([cliModel]), [cliModel.name, AUTO_CHAT_MODEL]);
    });

    test('preserves the default selection when reopening after models become available', () => {
        assert.deepStrictEqual(getModelPickerOptions([cliModel], DEFAULT_CHAT_MODEL), [DEFAULT_CHAT_MODEL, cliModel.name, AUTO_CHAT_MODEL]);
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
