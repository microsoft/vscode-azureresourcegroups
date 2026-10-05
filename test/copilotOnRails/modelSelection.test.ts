/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
    AvailableChatModel,
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

suite('Copilot on Rails model selection', () => {
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
