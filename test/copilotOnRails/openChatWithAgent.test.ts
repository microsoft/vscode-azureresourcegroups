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

    test('omits a model selector when the VS Code default is selected', async () => {
        const selector = await resolveModelSelector(DEFAULT_CHAT_MODEL);
        assert.deepStrictEqual(
            buildAgentChatOpenOptions('azure-project-plan', 'Build a project', selector),
            { mode: 'azure-project-plan', query: 'Build a project', waitForRequestAcceptance: true },
        );
    });

    test('selects Auto explicitly when requested', async () => {
        assert.deepStrictEqual(
            await resolveModelSelector(AUTO_CHAT_MODEL),
            { id: 'auto', vendor: 'agent-host-copilotcli' },
        );
    });

    test('disables CLI Auto during initial workspace setup', async () => {
        await ensureCopilotHarnessOn();
        const folder = workspace.workspaceFolders?.[0];
        const settingAvailable = folder && workspace.getConfiguration('github.copilot.chat.cli', folder.uri).inspect('autoModel.enabled');
        const autoUpdates = workspaceSettingUpdates.filter(([key]) => key === 'autoModel.enabled');
        assert.deepStrictEqual(autoUpdates, settingAvailable
            ? [['autoModel.enabled', false, folder?.uri.fsPath, 'github.copilot.chat.cli', ConfigurationTarget.Workspace]]
            : []);
    });

    for (const model of [DEFAULT_CHAT_MODEL, AUTO_CHAT_MODEL]) {
        test(`persists ${model} across phases and configures its workspace Auto flag`, async () => {
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
                await recordModel(model);
                for (const phase of ['scaffold', 'integrate', 'debug', 'deploy'] as const) {
                    await recordPhase(phase);
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
                const expectedUpdate = ['autoModel.enabled', model === AUTO_CHAT_MODEL, folder?.uri.fsPath, 'github.copilot.chat.cli', ConfigurationTarget.Workspace];
                assert.deepStrictEqual(workspaceSettingUpdates, settingAvailable ? Array(4).fill(expectedUpdate) : []);
            } finally {
                if (originalContext) {
                    Object.defineProperty(ext, 'context', originalContext);
                } else {
                    Reflect.deleteProperty(ext, 'context');
                }
            }
        });
    }

    test('builds options that select the custom agent without submitting a prompt', () => {
        assert.deepStrictEqual(
            buildAgentChatModeOptions('azure-project-integrate'),
            { mode: 'azure-project-integrate' },
        );
    });

    test('resolves the agent by name when submitting the prompt', () => {
        assert.deepStrictEqual(
            buildAgentChatOpenOptions(
                'azure-project-plan',
                'Build a project',
                { id: 'gpt-6.1-sol', vendor: 'agent-host-copilotcli' },
            ),
            {
                mode: 'azure-project-plan',
                query: 'Build a project',
                modelSelector: { id: 'gpt-6.1-sol', vendor: 'agent-host-copilotcli' },
                waitForRequestAcceptance: true,
            },
        );
    });

    test('carries Autopilot into fresh phase chats without changing the agent or model', () => {
        for (const agentName of ['azure-project-scaffold', 'azure-project-integrate', 'azure-debug-plan', 'azure-debug-generate', 'azure-deploy']) {
            assert.deepStrictEqual(
                buildAgentChatOpenOptions(agentName, 'Continue the project', { id: 'gpt-6.1-sol', vendor: 'agent-host-copilotcli' }, true),
                {
                    mode: agentName,
                    query: '[AUTOPILOT MODE] Continue the project',
                    modelSelector: { id: 'gpt-6.1-sol', vendor: 'agent-host-copilotcli' },
                    waitForRequestAcceptance: true,
                },
            );
        }
    });

    test('does not duplicate an existing Autopilot marker', () => {
        const query = '[AUTOPILOT MODE] I approve the plan.';
        assert.strictEqual(buildAgentChatOpenOptions('azure-project-scaffold', query, undefined, true).query, query);
    });

    test('preserves interactive handoff prompts', () => {
        assert.strictEqual(buildAgentChatOpenOptions('azure-project-integrate', 'Continue the project', undefined, false).query, 'Continue the project');
    });
});
