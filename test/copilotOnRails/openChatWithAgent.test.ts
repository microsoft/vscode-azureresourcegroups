/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { createTestActionContext } from '@microsoft/vscode-azext-utils';
import { ConfigurationTarget, workspace } from 'vscode';
import { buildAgentChatModeOptions, buildAgentChatOpenOptions, buildChatOpenOptions, resolveModelSelector } from '../../src/commands/copilotOnRails/openChatWithAgent';
import { ext } from '../../src/extensionVariables';
import { AUTO_CHAT_MODEL, DEFAULT_CHAT_MODEL } from '../../src/utils/copilotOnRails/modelSelection';
import { settingUtils } from '../../src/utils/settingUtils';
import { ensureCopilotHarnessOn } from '../../src/webviews/copilotOnRails/extension/harnessSettings';
import { getSessionModel, recordModel, recordPhase } from '../../src/webviews/copilotOnRails/extension/projectSession';

suite('Copilot on Rails agent chat launch', () => {
    const originalUpdateWorkspaceSetting = settingUtils.updateWorkspaceSetting;
    const workspaceSettingUpdates: Parameters<typeof settingUtils.updateWorkspaceSetting>[] = [];
    setup(() => {
        workspaceSettingUpdates.length = 0;
        settingUtils.updateWorkspaceSetting = async (...args) => { workspaceSettingUpdates.push(args); };
    });
    teardown(() => {
        settingUtils.updateWorkspaceSetting = originalUpdateWorkspaceSetting;
    });

    test('builds custom-agent requests with an explicit model or the VS Code default', async () => {
        const agentName = 'azure-project-plan';
        const query = 'Build a project';
        const expected = { mode: agentName, query, waitForRequestAcceptance: true };
        const selector = { id: 'gpt-6.1-sol', vendor: 'agent-host-copilotcli' };
        assert.deepStrictEqual(buildAgentChatModeOptions(agentName), { mode: agentName });
        assert.deepStrictEqual(
            buildAgentChatOpenOptions(agentName, query, selector),
            { ...expected, modelSelector: selector },
        );
        assert.deepStrictEqual(
            buildAgentChatOpenOptions(agentName, query, await resolveModelSelector(DEFAULT_CHAT_MODEL)),
            expected,
        );
    });

    test('enables the Copilot Harness at workspace scope and honors explicit Auto', async () => {
        const folder = workspace.workspaceFolders?.[0];
        assert.ok(folder, 'The extension test runner must provide a workspace');
        await ensureCopilotHarnessOn();
        assert.deepStrictEqual(workspaceSettingUpdates.slice(0, 2), [
            ['preferCopilotHarness', true, folder.uri.fsPath, 'chat.editor', ConfigurationTarget.Workspace],
            ['defaultToCopilotHarness', true, folder.uri.fsPath, 'chat', ConfigurationTarget.Workspace],
        ]);
        await ensureCopilotHarnessOn({ useAutoModel: true });
        const settingAvailable = workspace.getConfiguration('github.copilot.chat.cli', folder.uri).inspect('autoModel.enabled');
        const autoUpdates = workspaceSettingUpdates.filter(([key]) => key === 'autoModel.enabled');
        assert.deepStrictEqual(autoUpdates, settingAvailable
            ? [false, true].map(enabled => ['autoModel.enabled', enabled, folder.uri.fsPath, 'github.copilot.chat.cli', ConfigurationTarget.Workspace])
            : []);
    });

    test('preserves default and Auto selections across a phase handoff', async () => {
        const originalContext = Object.getOwnPropertyDescriptor(ext, 'context');
        const state = new Map<string, unknown>();
        Object.defineProperty(ext, 'context', {
            configurable: true,
            value: {
                workspaceState: {
                    get: (key: string) => state.get(key),
                    update: async (key: string, value: unknown) => { state.set(key, value); },
                },
            },
        });
        try {
            for (const model of [DEFAULT_CHAT_MODEL, AUTO_CHAT_MODEL]) {
                await recordModel(model);
                await recordPhase('scaffold');
                assert.strictEqual(getSessionModel(), model);
                const context = await createTestActionContext();
                const options = { query: 'Continue the project' };
                assert.deepStrictEqual(await buildChatOpenOptions(context, options), model === AUTO_CHAT_MODEL
                    ? { ...options, modelSelector: { id: 'auto', vendor: 'agent-host-copilotcli' } }
                    : options);
                assert.strictEqual(context.telemetry.properties.chatModelSelectionSource, model === DEFAULT_CHAT_MODEL ? 'default' : 'previouslySelected');
                assert.strictEqual(context.telemetry.properties.chatModelResolved, String(model === AUTO_CHAT_MODEL));
            }
            const folder = workspace.workspaceFolders?.[0];
            const settingAvailable = folder && workspace.getConfiguration('github.copilot.chat.cli', folder.uri).inspect('autoModel.enabled');
            const expectedUpdates = [false, true].map(enabled =>
                ['autoModel.enabled', enabled, folder?.uri.fsPath, 'github.copilot.chat.cli', ConfigurationTarget.Workspace]);
            assert.deepStrictEqual(workspaceSettingUpdates, settingAvailable ? expectedUpdates : []);
        } finally {
            if (originalContext) {
                Object.defineProperty(ext, 'context', originalContext);
            } else {
                Reflect.deleteProperty(ext, 'context');
            }
        }
    });

    test('marks Autopilot requests once without changing their agent or model', () => {
        assert.deepStrictEqual(
            buildAgentChatOpenOptions(
                'azure-project-scaffold',
                'Continue the project',
                { id: 'gpt-6.1-sol', vendor: 'agent-host-copilotcli' },
                true,
            ),
            {
                mode: 'azure-project-scaffold',
                query: '[AUTOPILOT MODE] Continue the project',
                modelSelector: { id: 'gpt-6.1-sol', vendor: 'agent-host-copilotcli' },
                waitForRequestAcceptance: true,
            },
        );
        const query = '[AUTOPILOT MODE] I approve the plan.';
        assert.strictEqual(buildAgentChatOpenOptions('azure-project-scaffold', query, undefined, true).query, query);
    });
});
