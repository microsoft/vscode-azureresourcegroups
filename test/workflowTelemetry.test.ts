/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "assert";
import {
    ALLOWED_WORKFLOW_PROPERTY_KEYS,
    buildPhaseTelemetry,
    buildSessionTelemetry,
    isDeploymentComplete,
    phaseForAgent,
    WORKFLOW_PHASES,
} from "../src/webviews/copilotOnRails/extension/telemetry/workflowTelemetry";

/** A representative in-flight session record used across the builder tests. */
function sampleRecord() {
    return {
        sessionId: 'abc-123',
        startedAt: 1_000,
        currentPhase: 'scaffold' as const,
        phaseStartedAt: 4_000,
        phaseDurationsMs: { requirements: 500, plan: 1_500 },
        toolCallCount: 7,
        toolFailureCount: 2,
        lastAgent: 'azure-project-scaffold',
        deadline: 10_000,
        phaseAgents: { requirements: 'azure-project-plan', plan: 'azure-project-plan', scaffold: 'azure-project-scaffold' },
        tools: [],
        autopilot: false,
        approvalCount: 0,
        approvalWaitMs: 0,
        revisionCount: 0,
        safetyTimerFired: false,
    };
}

suite('workflowTelemetry', () => {
    test('phaseForAgent maps workflow agents to phases', () => {
        assert.strictEqual(phaseForAgent('azure-project-scaffold'), 'scaffold');
        assert.strictEqual(phaseForAgent('azure-project-integrate'), 'integrate');
        assert.strictEqual(phaseForAgent('azure-debug-plan'), 'debug');
        assert.strictEqual(phaseForAgent('azure-debug-generate'), 'debug');
        assert.strictEqual(phaseForAgent('azure-deploy'), 'deploy');
    });

    test('phaseForAgent returns undefined for non-workflow agents', () => {
        assert.strictEqual(phaseForAgent('agent'), undefined);
        assert.strictEqual(phaseForAgent('some-other-mode'), undefined);
    });

    test('buildPhaseTelemetry records the ended phase and its duration', () => {
        const { properties, measurements } = buildPhaseTelemetry(sampleRecord(), 'plan', 1_500);
        assert.strictEqual(properties.phase, 'plan');
        assert.strictEqual(properties.agent, 'azure-project-scaffold');
        assert.strictEqual(properties.sessionId, 'abc-123');
        assert.strictEqual(measurements.phaseDurationMs, 1_500);
    });

    test('buildSessionTelemetry summarizes total + per-phase durations and counters', () => {
        const { properties, measurements } = buildSessionTelemetry(sampleRecord(), 'completed', 5_000);
        assert.strictEqual(properties.outcome, 'completed');
        assert.strictEqual(properties.lastPhase, 'scaffold');
        assert.strictEqual(measurements.durationMs, 4_000);
        assert.strictEqual(measurements.requirementsMs, 500);
        assert.strictEqual(measurements.planMs, 1_500);
        assert.strictEqual(measurements.toolCallCount, 7);
        assert.strictEqual(measurements.toolFailureCount, 2);
        // No measurement is emitted for phases that never ran.
        assert.strictEqual(measurements.deployMs, undefined);
    });

    test('buildSessionTelemetry records abandonedPhase only for abandoned runs', () => {
        const abandoned = buildSessionTelemetry(sampleRecord(), 'abandoned', 5_000);
        assert.strictEqual(abandoned.properties.abandonedPhase, 'scaffold');

        const completed = buildSessionTelemetry(sampleRecord(), 'completed', 5_000);
        assert.strictEqual(completed.properties.abandonedPhase, undefined);
    });

    test('isDeploymentComplete detects terminal deployment statuses', () => {
        assert.ok(isDeploymentComplete('> **Status:** Deployed'));
        assert.ok(isDeploymentComplete('Status: Complete'));
        assert.ok(isDeploymentComplete('**Status**: implemented'));
        assert.ok(!isDeploymentComplete('Status: Planning'));
        assert.ok(!isDeploymentComplete('no status here'));
    });

    suite('privacy guardrails', () => {
        const allowed = new Set<string>(ALLOWED_WORKFLOW_PROPERTY_KEYS);

        test('phase telemetry only emits allowlisted property keys', () => {
            const { properties } = buildPhaseTelemetry(sampleRecord(), 'plan', 1_500);
            for (const key of Object.keys(properties)) {
                assert.ok(allowed.has(key), `Unexpected telemetry property "${key}"`);
            }
        });

        test('session telemetry only emits allowlisted property keys for every outcome', () => {
            for (const outcome of ['completed', 'abandoned', 'errored'] as const) {
                const { properties } = buildSessionTelemetry(sampleRecord(), outcome, 5_000);
                for (const key of Object.keys(properties)) {
                    assert.ok(allowed.has(key), `Unexpected telemetry property "${key}" for outcome ${outcome}`);
                }
            }
        });

        test('emitted measurements are all finite numbers (no content strings)', () => {
            const { measurements } = buildSessionTelemetry(sampleRecord(), 'completed', 5_000);
            for (const [key, value] of Object.entries(measurements)) {
                assert.strictEqual(typeof value, 'number', `Measurement "${key}" must be numeric`);
                assert.ok(Number.isFinite(value), `Measurement "${key}" must be finite`);
            }
        });

        test('every workflow phase name is a short enum token (not free text)', () => {
            for (const phase of WORKFLOW_PHASES) {
                assert.ok(/^[a-z]+$/.test(phase), `Phase "${phase}" should be a simple enum token`);
            }
        });
    });
});
