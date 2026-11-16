/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'mocha';
import { AgentLaunchReportTracker } from '../../src/chat/tools/copilotOnRails/agentLaunchReportTracker';
import { normalizeAgentName } from '../../src/chat/tools/copilotOnRails/reportAgentLaunchTool';

suite('AgentLaunchReportTracker', () => {
    test('starts only one report for the same agent in a chat session', () => {
        const tracker = new AgentLaunchReportTracker();

        assert.strictEqual(tracker.tryStart('session-1', 'azure-project-plan'), true);
        assert.strictEqual(tracker.tryStart('session-1', 'azure-project-plan'), false);
    });

    test('tracks different agents and chat sessions independently', () => {
        const tracker = new AgentLaunchReportTracker();

        assert.strictEqual(tracker.tryStart('session-1', 'azure-project-plan'), true);
        assert.strictEqual(tracker.tryStart('session-1', 'azure-project-scaffold'), true);
        assert.strictEqual(tracker.tryStart('session-2', 'azure-project-plan'), true);
    });

    test('allows a failed report to be retried', () => {
        const tracker = new AgentLaunchReportTracker();

        assert.strictEqual(tracker.tryStart('session-1', 'azure-project-plan'), true);
        tracker.markFailed('session-1', 'azure-project-plan');

        assert.strictEqual(tracker.tryStart('session-1', 'azure-project-plan'), true);
    });

    test('normalizes untrusted agent names before telemetry and tracking', () => {
        assert.strictEqual(normalizeAgentName('azure-project-plan'), 'azure-project-plan');
        assert.strictEqual(normalizeAgentName('private-project-name@example.com'), 'unknown');
    });
});
