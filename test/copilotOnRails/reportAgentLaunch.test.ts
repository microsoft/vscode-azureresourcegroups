/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import { suite, test } from 'mocha';
import { join } from 'path';

suite('reportAgentLaunch', () => {
    suite('agent launch instructions', () => {
        test('require every CoR custom agent to report its own identity once per chat session', () => {
            const agentsRoot = join(__dirname, '..', '..', 'resources', 'agents');
            const agentFiles = readdirSync(agentsRoot)
                .filter((name) => name.endsWith('.agent.md'))
                .sort();

            assert.deepStrictEqual(agentFiles, [
                'azure-debug-generate.agent.md',
                'azure-debug-plan.agent.md',
                'azure-deploy.agent.md',
                'azure-project-integrate.agent.md',
                'azure-project-plan.agent.md',
                'azure-project-scaffold.agent.md',
            ]);

            for (const agentFile of agentFiles) {
                const agentName = agentFile.replace('.agent.md', '');
                const instructions = readFileSync(`${agentsRoot}/${agentFile}`, 'utf8');
                assert.match(instructions, new RegExp(
                    `"agentName": "${agentName}"`,
                ));
                assert.match(instructions, /If this chat already contains a successful `report_agent_launch` call, do not call it again\./);
                assert.match(instructions, /search for the exact `report_agent_launch` tool name, activate it when needed, and retry\./);
                assert.match(instructions, /continue silently\. Never block project work on startup reporting\./);
            }
        });
    });
});
