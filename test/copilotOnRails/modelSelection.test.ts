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
    id: 'cli-sol',
    vendor: 'copilotcli',
};

suite('Copilot on Rails model selection', () => {
    test('resolves explicit Auto and default without substituting missing named models', () => {
        assert.deepStrictEqual(
            resolveCopilotHarnessModelSelector(AUTO_CHAT_MODEL, []),
            { id: 'auto', vendor: 'agent-host-copilotcli' },
        );
        assert.strictEqual(resolveCopilotHarnessModelSelector('Unavailable model', [cliModel]), undefined);
        assert.strictEqual(resolveCopilotHarnessModelSelector(DEFAULT_CHAT_MODEL, [{ ...cliModel, id: DEFAULT_CHAT_MODEL }]), undefined);
    });

    test('excludes Auto from named-model filtering and prefers an actual CLI Opus model', () => {
        const opus = { ...cliModel, id: 'claude-opus-4.6', name: 'Claude Opus 4.6', family: 'opus', version: '4.6' };
        const auto = { ...opus, id: 'auto', name: AUTO_CHAT_MODEL };
        assert.deepStrictEqual(getSupportedModelOptions([auto, opus, cliModel]), [opus.name, cliModel.name]);
        assert.deepStrictEqual(getModelPickerOptions([auto]), []);
        assert.strictEqual(getDefaultOpusModelOption([auto, opus]), opus.name);
    });

    test('offers Auto once after named models and preserves a reopened default selection', () => {
        const auto = { ...cliModel, id: 'auto', name: AUTO_CHAT_MODEL, family: 'claude-sonnet-5' };
        assert.deepStrictEqual(getModelPickerOptions([cliModel]), [cliModel.name, AUTO_CHAT_MODEL]);
        assert.deepStrictEqual(getModelPickerOptions([auto, cliModel]), [cliModel.name, AUTO_CHAT_MODEL]);
        assert.deepStrictEqual(getModelPickerOptions([cliModel], DEFAULT_CHAT_MODEL), [DEFAULT_CHAT_MODEL, cliModel.name, AUTO_CHAT_MODEL]);
    });

    test('maps a discovered CLI model id to the Agent Host launch vendor', () => {
        assert.deepStrictEqual(
            resolveCopilotHarnessModelSelector('GPT-6.1 Sol', [cliModel]),
            { id: cliModel.id, vendor: 'agent-host-copilotcli' },
        );
    });

    test('hides the picker when no supported named models are available', () => {
        assert.deepStrictEqual(getModelPickerOptions([]), []);
        const model = { ...cliModel, id: 'haiku', name: 'Claude Haiku 4.5', family: 'haiku' };
        assert.deepStrictEqual(getModelPickerOptions([model]), []);
    });

    test('resolves display names, IDs, and legacy vendor-qualified names', () => {
        assert.strictEqual(resolveAvailableChatModel(cliModel.name, [cliModel]), cliModel);
        assert.strictEqual(resolveAvailableChatModel(cliModel.id, [cliModel]), cliModel);
        assert.strictEqual(resolveAvailableChatModel('GPT-6.1 Sol (copilot)', [localModel, cliModel]), localModel);
        assert.strictEqual(resolveAvailableChatModel('GPT-6.1 Sol (copilotcli)', [localModel, cliModel]), cliModel);
    });
});
