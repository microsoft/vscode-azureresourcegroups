/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
    AvailableChatModel,
    getSupportedModelOptions,
    resolveAvailableChatModel,
    resolveCopilotHarnessModel,
} from '../../src/utils/copilotOnRails/modelSelection';

const localModel: AvailableChatModel = {
    id: 'gpt-6.1-sol',
    vendor: 'copilot',
    family: 'gpt-6.1-sol',
    version: '6.1',
    name: 'GPT-6.1 Sol',
};

const harnessModel: AvailableChatModel = {
    ...localModel,
    vendor: 'agent-host-copilotcli',
};

const legacyHarnessModel: AvailableChatModel = {
    ...localModel,
    vendor: 'copilotcli',
};

const opusModel: AvailableChatModel = {
    id: 'claude-opus-5.5',
    vendor: 'copilot',
    family: 'claude-opus-5.5',
    version: '5.5',
    name: 'Claude Opus 5.5',
};

suite('Copilot on Rails model selection', () => {
    test('includes available Opus models in the picker', () => {
        assert.deepStrictEqual(
            getSupportedModelOptions([localModel, opusModel]),
            ['Claude Opus 5.5 (copilot)', 'GPT-6.1 Sol (copilot)'],
        );
    });

    test('returns no picker options when VS Code reports no models', () => {
        assert.deepStrictEqual(getSupportedModelOptions([]), []);
    });

    test('resolves a qualified local model name', () => {
        assert.strictEqual(
            resolveAvailableChatModel('GPT-6.1 Sol (copilot)', [localModel, harnessModel]),
            localModel,
        );
    });

    test('maps a local Copilot model to the Agent Host model with the same id', () => {
        assert.strictEqual(
            resolveCopilotHarnessModel('GPT-6.1 Sol (copilot)', [localModel, legacyHarnessModel, harnessModel]),
            harnessModel,
        );
    });

    test('constructs an Agent Host selector when the extension API omits Agent Host models', () => {
        assert.deepStrictEqual(
            resolveCopilotHarnessModel('GPT-6.1 Sol (copilot)', [localModel, legacyHarnessModel]),
            harnessModel,
        );
    });
});
