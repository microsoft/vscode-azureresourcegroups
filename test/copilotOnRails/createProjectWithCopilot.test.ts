/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTestActionContext } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
import { ensureRequiredCopilotOnRailsContext } from '../../src/utils/copilotOnRails/CopilotOnRailsContext';
import { AvailableChatModel, getSupportedModelOptions } from '../../src/utils/copilotOnRails/modelSelection';
import {
    OPEN_PROJECT_FOLDER_OPTIONS,
    PROJECT_FOLDER_SELECTION_TELEMETRY_KEY,
    ProjectFolderSelection,
    recordProjectFolderSelection,
    recordModelPickerDiscovery,
    validateProjectSubfolderName,
} from '../../src/webviews/copilotOnRails/extension/createProjectWithCopilot';

suite('Create Project with Copilot folder selection', () => {
    for (const selection of ['newSubfolder', 'selectedEmptyFolder'] satisfies ProjectFolderSelection[]) {
        test(`records ${selection} in telemetry and diagnostics`, async () => {
            const context = ensureRequiredCopilotOnRailsContext(await createTestActionContext());

            recordProjectFolderSelection(context, selection);

            assert.strictEqual(context.telemetry.properties[PROJECT_FOLDER_SELECTION_TELEMETRY_KEY], selection);
            assert.strictEqual(context.diagnostics.properties[PROJECT_FOLDER_SELECTION_TELEMETRY_KEY], selection);
        });
    }

    test('always opens the project folder in a new window', () => {
        assert.deepStrictEqual(OPEN_PROJECT_FOLDER_OPTIONS, { forceNewWindow: true });
    });

    test('accepts a direct child folder name', () => {
        assert.strictEqual(validateProjectSubfolderName('my-project'), undefined);
        assert.strictEqual(validateProjectSubfolderName('My Project'), undefined);
    });

    for (const value of ['', '   ', '.', '..', '../outside', '..\\outside', 'nested/project', 'nested\\project']) {
        test(`rejects unsafe folder name ${JSON.stringify(value)}`, () => {
            assert.ok(validateProjectSubfolderName(value));
        });
    }
});

suite('Create Project with Copilot model picker diagnostics', () => {
    const sonnet: AvailableChatModel = {
        id: 'claude-sonnet-5',
        vendor: 'copilotcli',
        name: 'Claude Sonnet 5',
        family: 'sonnet',
        version: '5',
    };
    const haiku: AvailableChatModel = {
        ...sonnet,
        id: 'claude-haiku-4.5',
        name: 'Claude Haiku 4.5',
        family: 'haiku',
        version: '4.5',
    };

    for (const scenario of [
        { name: 'empty catalog', models: [], supported: 0, excluded: 0, shown: 0, outcome: 'emptyCatalog' },
        { name: 'unsupported catalog', models: [haiku], supported: 0, excluded: 1, shown: 0, outcome: 'noSupportedModels' },
        { name: 'supported catalog with duplicate labels', models: [sonnet, haiku, sonnet], supported: 2, excluded: 1, shown: 1, outcome: 'ready' },
    ]) {
        test(`records counts and outcome for ${scenario.name} in telemetry and diagnostics`, async () => {
            const context = ensureRequiredCopilotOnRailsContext(await createTestActionContext());
            const options = getSupportedModelOptions(scenario.models);

            recordModelPickerDiscovery(context, scenario.models, options);

            const expected = {
                modelPickerReturnedModelCount: scenario.models.length,
                modelPickerSupportedModelCount: scenario.supported,
                modelPickerFilteredOutModelCount: scenario.excluded,
                availableModelCount: scenario.shown,
                modelPickerOutcome: scenario.outcome,
            };
            for (const [key, value] of Object.entries(expected)) {
                assert.strictEqual(context.telemetry.properties[key], String(value));
                assert.strictEqual(context.diagnostics.properties[key], value);
            }
            assert.deepStrictEqual(context.diagnostics.properties.modelPickerReturnedModels, scenario.models);
            assert.deepStrictEqual(context.diagnostics.properties.modelPickerShownModels, options);
            assert.strictEqual(context.telemetry.properties.modelPickerReturnedModels, undefined);
            assert.strictEqual(context.telemetry.properties.modelPickerShownModels, undefined);
        });
    }
});
