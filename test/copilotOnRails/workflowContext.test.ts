/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
    beginCorPhaseInState,
    completeCorPhaseInState,
    createCorWorkflowState,
    getCorWorkflowTelemetryFromState,
    parseCorWorkflowHandoff,
    recordCorToolCallInState,
} from '../../src/utils/copilotOnRails/workflowContext';

const workflowRunId = '11111111-1111-4111-8111-111111111111';
const firstPhaseRunId = '22222222-2222-4222-8222-222222222222';
const secondPhaseRunId = '33333333-3333-4333-8333-333333333333';

suite('workflowContext', () => {
    test('preserves workflow identity across a reload handoff', () => {
        const handoff = parseCorWorkflowHandoff({
            schemaVersion: '2',
            workflowRunId,
            entryPoint: 'createProject',
            startedAt: 1000,
            prompt: 'must not be accepted',
            path: 'C:\\private',
        });

        assert.deepStrictEqual(handoff, {
            schemaVersion: '2',
            workflowRunId,
            entryPoint: 'createProject',
            startedAt: 1000,
        });
    });

    test('assigns parent and retry identities to repeated phase attempts', () => {
        const initial = createCorWorkflowState('createProject', 1000, workflowRunId);
        const first = beginCorPhaseInState(initial, 'deploy', 'phaseHandoff', 2000, firstPhaseRunId);
        const retry = beginCorPhaseInState(first, 'deploy', 'resume', 3000, secondPhaseRunId);

        assert.strictEqual(retry.currentPhase?.phaseRunId, secondPhaseRunId);
        assert.strictEqual(retry.currentPhase?.parentPhaseRunId, firstPhaseRunId);
        assert.strictEqual(retry.currentPhase?.attemptNumber, 2);
        assert.strictEqual(retry.currentPhase?.retryCount, 1);
        assert.strictEqual(retry.currentPhase?.entryPoint, 'resume');
    });

    test('aggregates only bounded tool names and durations', () => {
        const initial = createCorWorkflowState('mcpTool', 1000, workflowRunId);
        const known = recordCorToolCallInState(initial, 'open_deploy_result_view', 125);
        const unknown = recordCorToolCallInState(known, 'private-user-supplied-tool', 50);

        assert.strictEqual(unknown.toolCallCount, 2);
        assert.strictEqual(unknown.toolDurationMs, 175);
        const expectedDurations: Record<string, number> = { other: 50 };
        expectedDurations['open_deploy_result_view'] = 125;
        assert.deepStrictEqual(unknown.toolDurationsMs, expectedDurations);
    });

    test('separates workflow active time from approval wait time', () => {
        const state = {
            ...createCorWorkflowState('createProject', 1000, workflowRunId),
            userWaitDurationMs: 250,
            waitingSince: 1750,
        };
        const telemetry = getCorWorkflowTelemetryFromState(state, 2000);

        assert.strictEqual(telemetry.measurements.workflowDurationMs, 1000);
        assert.strictEqual(telemetry.measurements.workflowUserWaitDurationMs, 500);
        assert.strictEqual(telemetry.measurements.workflowActiveDurationMs, 500);
        assert.strictEqual(telemetry.properties.workflowRunId, workflowRunId);
    });

    test('keeps the workflow active until a terminal phase and freezes its duration', () => {
        const initial = createCorWorkflowState('createProject', 1000, workflowRunId);
        const debugging = beginCorPhaseInState(initial, 'debug', 'phaseHandoff', 1500, firstPhaseRunId);
        const debugComplete = completeCorPhaseInState(debugging, 'debug', 'succeeded', {}, 2000);
        assert.strictEqual(debugComplete.lifecycleState, 'started');

        const deploying = beginCorPhaseInState(debugComplete, 'deploy', 'phaseHandoff', 2500, secondPhaseRunId);
        const deployed = completeCorPhaseInState(deploying, 'deploy', 'succeeded', {}, 3000);
        const telemetry = getCorWorkflowTelemetryFromState(deployed, 5000);

        assert.strictEqual(deployed.lifecycleState, 'succeeded');
        assert.strictEqual(telemetry.properties.workflowLifecycleState, 'succeeded');
        assert.strictEqual(telemetry.properties.workflowCompletedTimestamp, new Date(3000).toISOString());
        assert.strictEqual(telemetry.measurements.workflowDurationMs, 2000);
    });
});
