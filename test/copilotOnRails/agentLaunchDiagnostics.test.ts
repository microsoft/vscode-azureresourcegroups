/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import { suite, test } from 'mocha';
import { join } from 'path';
import {
    acknowledgeLatestAgentLaunch,
    appendAgentLaunch,
    type AgentLaunchDiagnostic,
} from '../../src/utils/copilotOnRails/agentLaunchRecord';

function launch(expectedAgent: string, id: string, attemptedAt: string): AgentLaunchDiagnostic {
    return appendAgentLaunch([], {
        expectedAgent,
    }, id, attemptedAt)[0];
}

suite('agentLaunchDiagnostics', () => {
    test('keeps a launch unacknowledged until the startup tool is called', () => {
        const record = launch('azure-project-plan', 'launch-1', '2026-09-12T10:00:00.000Z');

        assert.strictEqual(record.chatOpenCommandOutcome, 'pending');
        assert.strictEqual(record.acknowledgedAt, undefined);
        assert.strictEqual(record.reportedAgent, undefined);
    });

    test('records the agent report against the latest pending launch', () => {
        const launches = [
            launch('azure-project-plan', 'launch-1', '2026-09-12T10:00:00.000Z'),
            launch('azure-project-scaffold', 'launch-2', '2026-09-12T10:01:00.000Z'),
        ];

        const result = acknowledgeLatestAgentLaunch(launches, {
            agentName: 'azure-project-scaffold',
        }, '2026-09-12T10:01:01.000Z');

        assert.strictEqual(result.launches[0].acknowledgedAt, undefined);
        assert.deepStrictEqual(result.acknowledgedLaunch, {
            ...launches[1],
            acknowledgedAt: '2026-09-12T10:01:01.000Z',
            reportedAgent: 'azure-project-scaffold',
            agentMatched: true,
        });
    });

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

    test('preserves a wrong-agent report instead of treating it as no acknowledgement', () => {
        const launches = [launch('azure-project-plan', 'launch-1', '2026-09-12T10:00:00.000Z')];

        const result = acknowledgeLatestAgentLaunch(launches, {
            agentName: 'agent',
        }, '2026-09-12T10:00:01.000Z');

        assert.strictEqual(result.acknowledgedLaunch?.reportedAgent, 'agent');
        assert.strictEqual(result.acknowledgedLaunch?.agentMatched, false);
    });

    test('does not overwrite an acknowledged launch when the tool is called again', () => {
        const launches = [launch('azure-project-plan', 'launch-1', '2026-09-12T10:00:00.000Z')];
        const first = acknowledgeLatestAgentLaunch(launches, {
            agentName: 'azure-project-plan',
        }, '2026-09-12T10:00:01.000Z');

        const duplicate = acknowledgeLatestAgentLaunch(first.launches, {
            agentName: 'azure-project-plan',
        }, '2026-09-12T10:00:02.000Z');

        assert.strictEqual(duplicate.acknowledgedLaunch, undefined);
        assert.deepStrictEqual(duplicate.launches, first.launches);
    });
});
