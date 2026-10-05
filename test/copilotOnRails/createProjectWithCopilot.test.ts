/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTestActionContext } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
import { ext } from '../../src/extensionVariables';
import { ensureRequiredCopilotOnRailsContext } from '../../src/utils/copilotOnRails/CopilotOnRailsContext';
import { AvailableChatModel, getSupportedModelOptions } from '../../src/utils/copilotOnRails/modelSelection';
import { callWithDiagnosticsAndTelemetryHandling, getCorProjectId, initializeCorProjectId } from '../../src/utils/copilotOnRails/telemetryUtils';
import {
    OPEN_PROJECT_FOLDER_OPTIONS,
    PROJECT_FOLDER_SELECTION_TELEMETRY_KEY,
    ProjectFolderSelection,
    recordProjectFolderSelection,
    recordModelPickerDiscovery,
    discoverModelPickerModels,
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
    test('retries an empty catalog once per extension-host session, not on later runs', async () => {
        const firstContext = ensureRequiredCopilotOnRailsContext(await createTestActionContext());
        let firstQueries = 0;
        const models = await discoverModelPickerModels(firstContext, async () => {
            firstQueries++;
            return firstQueries === 1 ? [] : [sonnet];
        });
        assert.deepStrictEqual(models, [sonnet]);
        assert.strictEqual(firstQueries, 2);
        assert.strictEqual(firstContext.diagnostics.properties.modelPickerRetried, true);
        assert.strictEqual(firstContext.telemetry.properties.modelPickerRetried, 'true');

        const nextContext = ensureRequiredCopilotOnRailsContext(await createTestActionContext());
        let nextQueries = 0;
        const nextModels = await discoverModelPickerModels(nextContext, async () => {
            nextQueries++;
            return [];
        });
        assert.deepStrictEqual(nextModels, []);
        assert.strictEqual(nextQueries, 1);
        assert.strictEqual(nextContext.diagnostics.properties.modelPickerRetried, false);
        assert.strictEqual(nextContext.diagnostics.properties.modelPickerOutcome, 'emptyCatalog');
    });

    test('records discovery failures without blocking the default-model fallback', async () => {
        const context = ensureRequiredCopilotOnRailsContext(await createTestActionContext());
        const models = await discoverModelPickerModels(context, async () => { throw new Error('Model provider unavailable'); });

        assert.deepStrictEqual(models, []);
        assert.strictEqual(context.diagnostics.properties.modelPickerOutcome, 'queryFailed');
        assert.strictEqual(context.telemetry.properties.modelPickerOutcome, 'queryFailed');
        assert.strictEqual(context.diagnostics.properties.modelPickerError, 'Model provider unavailable');
        assert.strictEqual(context.telemetry.properties.modelPickerError, 'Model provider unavailable');
        assert.strictEqual(context.diagnostics.properties.modelPickerAvailableModelCount, 0);
        assert.strictEqual(context.diagnostics.properties.modelPickerFilteredModelCount, 0);
        assert.deepStrictEqual(context.diagnostics.properties.modelPickerAvailableModels, []);
        assert.deepStrictEqual(context.diagnostics.properties.modelPickerFilteredModels, []);
    });

    test('records available models when discovery succeeds', async () => {
        const context = ensureRequiredCopilotOnRailsContext(await createTestActionContext());
        const models = await discoverModelPickerModels(context, async () => [sonnet]);

        assert.deepStrictEqual(models, [sonnet]);
        assert.strictEqual(context.diagnostics.properties.modelPickerOutcome, 'ready');
        assert.strictEqual(context.diagnostics.properties.modelPickerVendor, 'copilotcli');
        assert.strictEqual(context.diagnostics.properties.modelPickerError, undefined);
    });

    test('leaves discovery unassigned and initializes the project id at prompt submission', async () => {
        const originalContext = Object.getOwnPropertyDescriptor(ext, 'context');
        const state = new Map<string, unknown>();
        Object.defineProperty(ext, 'context', {
            configurable: true,
            value: {
                globalState: { get: () => false },
                workspaceState: {
                    get: (key: string, defaultValue?: unknown) => state.get(key) ?? defaultValue,
                    update: async (key: string, value: unknown) => { state.set(key, value); },
                },
            },
        });
        try {
            const discoveryContext = await createTestActionContext();
            await callWithDiagnosticsAndTelemetryHandling(
                discoveryContext,
                { type: 'extensionAction', name: 'copilotOnRails.createProjectWithCopilot' },
                async () => { assert.strictEqual(getCorProjectId(), undefined); },
            );
            assert.strictEqual(getCorProjectId(), undefined);
            assert.strictEqual(discoveryContext.telemetry.properties.corProjectId, undefined);

            const projectId = await initializeCorProjectId();
            assert.ok(projectId);
            const submitContext = await createTestActionContext();
            await callWithDiagnosticsAndTelemetryHandling(
                submitContext,
                { type: 'webviewAction', name: 'createProjectSubmitPrompt' },
                async () => { assert.strictEqual(getCorProjectId(), projectId); },
            );
            assert.strictEqual(submitContext.telemetry.properties.corProjectId, projectId);
            assert.strictEqual(getCorProjectId(), projectId);
            assert.strictEqual(await initializeCorProjectId(), projectId);
            const nextCreateContext = await createTestActionContext();
            await callWithDiagnosticsAndTelemetryHandling(
                nextCreateContext,
                { type: 'extensionAction', name: 'copilotOnRails.createProjectWithCopilot' },
                async () => { assert.strictEqual(getCorProjectId(), projectId); },
            );
            assert.strictEqual(nextCreateContext.telemetry.properties.corProjectId, undefined);
        } finally {
            if (originalContext) {
                Object.defineProperty(ext, 'context', originalContext);
            } else {
                Reflect.deleteProperty(ext, 'context');
            }
        }
    });

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
        { name: 'empty catalog', models: [], filtered: 0, outcome: 'emptyCatalog' },
        { name: 'unsupported catalog', models: [haiku], filtered: 0, outcome: 'noSupportedModels' },
        { name: 'supported catalog with duplicate labels', models: [sonnet, haiku, sonnet], filtered: 1, outcome: 'ready' },
    ]) {
        test(`records counts and outcome for ${scenario.name} in telemetry and diagnostics`, async () => {
            const context = ensureRequiredCopilotOnRailsContext(await createTestActionContext());
            const options = getSupportedModelOptions(scenario.models);

            recordModelPickerDiscovery(context, scenario.models, options);

            const expected = {
                modelPickerAvailableModelCount: scenario.models.length,
                modelPickerFilteredModelCount: scenario.filtered,
                modelPickerOutcome: scenario.outcome,
            };
            for (const [key, value] of Object.entries(expected)) {
                assert.strictEqual(context.telemetry.properties[key], String(value));
                assert.strictEqual(context.diagnostics.properties[key], value);
            }
            assert.deepStrictEqual(context.diagnostics.properties.modelPickerAvailableModels, scenario.models.map(model => model.name));
            assert.deepStrictEqual(context.diagnostics.properties.modelPickerFilteredModels, options);
            assert.strictEqual(context.telemetry.properties.modelPickerAvailableModels, undefined);
            assert.strictEqual(context.telemetry.properties.modelPickerFilteredModels, undefined);
            for (const key of ['modelPickerReturnedModelCount', 'modelPickerSupportedModelCount', 'modelPickerFilteredOutModelCount', 'availableModelCount', 'modelPickerReturnedModels', 'modelPickerShownModels']) {
                assert.strictEqual(context.telemetry.properties[key], undefined);
                assert.strictEqual(context.diagnostics.properties[key], undefined);
            }
        });
    }
});
