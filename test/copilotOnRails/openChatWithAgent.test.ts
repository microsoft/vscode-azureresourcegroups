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
});
