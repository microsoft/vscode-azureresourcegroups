/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { buildAgentChatModeOptions, buildAgentChatOpenOptions } from '../../src/commands/copilotOnRails/openChatWithAgent';

suite('Copilot on Rails agent chat launch', () => {
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
                { id: 'gpt-6.1-sol', vendor: 'copilotcli' },
            ),
            {
                mode: 'azure-project-plan',
                query: 'Build a project',
                modelSelector: { id: 'gpt-6.1-sol', vendor: 'copilotcli' },
                waitForRequestAcceptance: true,
            },
        );
    });

    test('carries Autopilot into fresh phase chats without changing the agent or model', () => {
        for (const agentName of ['azure-project-scaffold', 'azure-project-integrate', 'azure-debug-plan', 'azure-debug-generate', 'azure-deploy']) {
            assert.deepStrictEqual(
                buildAgentChatOpenOptions(agentName, 'Continue the project', { id: 'gpt-6.1-sol', vendor: 'copilotcli' }, true),
                {
                    mode: agentName,
                    query: '[AUTOPILOT MODE] Continue the project',
                    modelSelector: { id: 'gpt-6.1-sol', vendor: 'copilotcli' },
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
