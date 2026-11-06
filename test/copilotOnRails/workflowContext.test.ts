/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
    beginCorPhaseInState,
    completeCorPhaseInState,
    completeCorWorkflowInState,
    createCorWorkflowState,
    ensureCorWorkflowInState,
    getCorWorkflowTelemetryFromState,
    isCorPhaseBoundToArtifact,
    markCorWorkflowWaitingInState,
    parseCorWorkflowHandoff,
    recordCorUserWaitInState,
    recordCorToolCallInState,
    restoreCorWorkflowHandoffInState,
    settleCorWorkflowWaitInState,
    shouldConsumeCorUserWait,
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
            userWaitDurationMs: 250,
            prompt: 'must not be accepted',
            path: 'C:\\private',
        });

        assert.deepStrictEqual(handoff, {
            schemaVersion: '2',
            workflowRunId,
            entryPoint: 'createProject',
            startedAt: 1000,
            userWaitDurationMs: 250,
        });
    });

    test('rejects timestamps outside the JavaScript Date range', () => {
        assert.strictEqual(parseCorWorkflowHandoff({
            schemaVersion: '2',
            workflowRunId,
            entryPoint: 'folderHandoff',
            startedAt: 1e100,
            userWaitDurationMs: 0,
        }), undefined);
    });

    test('starts explicit launches fresh but preserves continuations', () => {
        const current = createCorWorkflowState('createProject', 1000, workflowRunId);
        const continuation = ensureCorWorkflowInState(current, 'folderHandoff', 2000, secondPhaseRunId);
        const fresh = ensureCorWorkflowInState(current, 'createProject', 2000, secondPhaseRunId);

        assert.strictEqual(continuation, current);
        assert.strictEqual(fresh.workflowRunId, secondPhaseRunId);
        assert.strictEqual(fresh.startedAt, 2000);
    });

    test('replaces mismatched handoffs and restores accumulated wait time', () => {
        const current = createCorWorkflowState('createProject', 1000, workflowRunId);
        const restored = restoreCorWorkflowHandoffInState(current, {
            schemaVersion: '2',
            workflowRunId: secondPhaseRunId,
            entryPoint: 'folderHandoff',
            startedAt: 1500,
            userWaitDurationMs: 450,
        });

        assert.strictEqual(restored.workflowRunId, secondPhaseRunId);
        assert.strictEqual(restored.userWaitDurationMs, 450);
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

    test('retains one attempt across same-phase agent handoffs', () => {
        const initial = createCorWorkflowState('createProject', 1000, workflowRunId);
        const planning = beginCorPhaseInState(initial, 'plan', 'phaseHandoff', 2000, firstPhaseRunId);
        const requirementsContinuation = beginCorPhaseInState(planning, 'plan', 'phaseHandoff', 3000, secondPhaseRunId);

        assert.strictEqual(requirementsContinuation, planning);
        assert.strictEqual(requirementsContinuation.currentPhase?.attemptNumber, 1);
    });

    test('records successful forward phase boundaries', () => {
        const initial = createCorWorkflowState('createProject', 1000, workflowRunId);
        const planning = beginCorPhaseInState(initial, 'plan', 'phaseHandoff', 1500, firstPhaseRunId);
        const planned = completeCorPhaseInState(planning, 'plan', 'succeeded', {}, 2000);
        const scaffolding = beginCorPhaseInState(planned, 'scaffold', 'phaseHandoff', 2500, secondPhaseRunId);

        assert.strictEqual(planned.currentPhase?.lifecycleState, 'succeeded');
        assert.strictEqual(planned.currentPhase?.completedAt, 2000);
        assert.strictEqual(scaffolding.currentPhase?.parentPhaseRunId, firstPhaseRunId);
        assert.strictEqual(scaffolding.currentPhase?.attemptNumber, 1);
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

    test('workflow cancellation remains possible after a successful phase', () => {
        const initial = createCorWorkflowState('createProject', 1000, workflowRunId);
        const planning = beginCorPhaseInState(initial, 'plan', 'phaseHandoff', 1500, firstPhaseRunId);
        const planned = completeCorPhaseInState(planning, 'plan', 'succeeded', {}, 2000);
        const canceled = completeCorWorkflowInState(planned, 'canceled', { cancelReason: 'resumeDeclined' }, 2500);

        assert.strictEqual(canceled.currentPhase?.lifecycleState, 'succeeded');
        assert.strictEqual(canceled.lifecycleState, 'canceled');
        assert.strictEqual(canceled.cancelReason, 'resumeDeclined');
    });

    test('terminal workflows freeze user-wait timing', () => {
        const waiting = markCorWorkflowWaitingInState(createCorWorkflowState('createProject', 1000, workflowRunId), 1500);
        const completed = completeCorWorkflowInState(waiting, 'canceled', { cancelReason: 'resumeDeclined' }, 2000);

        assert.strictEqual(completed.userWaitDurationMs, 500);
        assert.strictEqual(settleCorWorkflowWaitInState(completed, 3000), completed);
        assert.strictEqual(markCorWorkflowWaitingInState(completed, 3000), completed);
        assert.strictEqual(recordCorUserWaitInState(completed, 1000), completed);
    });

    test('background observations do not consume approval waits', () => {
        assert.strictEqual(shouldConsumeCorUserWait('background'), false);
        assert.strictEqual(shouldConsumeCorUserWait('webview'), true);
        assert.strictEqual(shouldConsumeCorUserWait('background', true), true);
    });

    test('deployment artifacts only match their bound phase attempt', () => {
        const deploying = beginCorPhaseInState(
            createCorWorkflowState('createProject', 1000, workflowRunId),
            'deploy',
            'phaseHandoff',
            1500,
            firstPhaseRunId,
        );
        const bound = {
            ...deploying,
            currentPhase: {
                ...deploying.currentPhase!,
                artifactId: 'deployment-session-2',
            },
        };

        assert.strictEqual(isCorPhaseBoundToArtifact(bound, 'deploy', 'deployment-session-1'), false);
        assert.strictEqual(isCorPhaseBoundToArtifact(bound, 'deploy', 'deployment-session-2'), true);
    });
});
