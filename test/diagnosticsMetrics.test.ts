/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "assert";
import { analyzePerformance, categorizeTool, computeToolStats, percentile } from "../src/webviews/copilotOnRails/extension/telemetry/diagnosticsMetrics";
import { type DiagnosticsPhaseEntry, type DiagnosticsToolEntry, type WorkflowDiagnosticsRecord } from "../src/webviews/copilotOnRails/extension/telemetry/workflowDiagnostics";

const phases: DiagnosticsPhaseEntry[] = [
    { phase: 'plan', durationMs: 1, status: 'completed' },
    { phase: 'scaffold', durationMs: 1, status: 'completed' },
];

const tools: DiagnosticsToolEntry[] = [
    { name: 'read_file', phase: 'plan', latencyMs: 50, success: true },
    { name: 'edit_file', phase: 'scaffold', latencyMs: 200, success: true, targetHash: 'aaa' },
    { name: 'edit_file', phase: 'scaffold', latencyMs: 300, success: true, targetHash: 'aaa' },
    { name: 'run_in_terminal', phase: 'scaffold', latencyMs: 5_000, success: false },
    { name: 'run_in_terminal', phase: 'scaffold', latencyMs: 100, success: true },
];

suite('diagnosticsMetrics', () => {
    test('categorizeTool buckets tools by name', () => {
        assert.strictEqual(categorizeTool('read_file'), 'read');
        assert.strictEqual(categorizeTool('view'), 'read');
        assert.strictEqual(categorizeTool('edit_file'), 'edit');
        assert.strictEqual(categorizeTool('replace_string_in_file'), 'edit');
        assert.strictEqual(categorizeTool('run_in_terminal'), 'terminal');
        assert.strictEqual(categorizeTool('mcp_azure_mcp_documentation'), 'mcp');
        assert.strictEqual(categorizeTool('azure-documentation'), 'mcp');
        assert.strictEqual(categorizeTool('vscode_askQuestions'), 'question');
    });

    test('percentile returns 0 for empty and the right index otherwise', () => {
        assert.strictEqual(percentile([], 0.5), 0);
        assert.strictEqual(percentile([50, 100, 200, 300, 5000], 0.5), 200);
        assert.strictEqual(percentile([50, 100, 200, 300, 5000], 0.95), 5000);
    });

    test('computeToolStats aggregates counts, categories, and latency', () => {
        const s = computeToolStats(tools, phases);
        assert.strictEqual(s.total, 5);
        assert.strictEqual(s.failures, 1);
        assert.strictEqual(s.byCategory.read, 1);
        assert.strictEqual(s.byCategory.edit, 2);
        assert.strictEqual(s.byCategory.terminal, 2);
        assert.strictEqual(s.terminalFailures, 1);
        assert.strictEqual(s.p50LatencyMs, 200);
        assert.strictEqual(s.p95LatencyMs, 5_000);
    });

    test('computeToolStats detects retries and edit churn', () => {
        const s = computeToolStats(tools, phases);
        // The failed run_in_terminal is followed by another run_in_terminal → 1 retry.
        assert.strictEqual(s.retriedCalls, 1);
        // Two edits to the same hashed file → 1 unique file, churn 2.
        assert.strictEqual(s.uniqueFilesTouched, 1);
        assert.strictEqual(s.editChurnRatio, 2);
    });
});

function record(overrides: Partial<WorkflowDiagnosticsRecord> = {}): WorkflowDiagnosticsRecord {
    return {
        sessionId: 'abcdef12-3456-7890-abcd-ef1234567890',
        startedAt: 0,
        endedAt: 10,
        outcome: 'completed',
        totalDurationMs: 10,
        phases,
        toolCallCount: tools.length,
        toolFailureCount: tools.filter((t) => !t.success).length,
        tools,
        ...overrides,
    };
}

suite('analyzePerformance', () => {
    test('summarizes reliability and success rate', () => {
        const a = analyzePerformance(record());
        assert.strictEqual(a.totalCalls, 5);
        assert.strictEqual(a.failures, 1);
        assert.strictEqual(a.successRatePct, 80);
    });

    test('counts retries, rework, and re-edited files', () => {
        const a = analyzePerformance(record());
        assert.strictEqual(a.retriedCalls, 1);
        // Two edits landed on the same hashed file → 1 re-edited file, max 2×.
        assert.strictEqual(a.reeditedFileCount, 1);
        assert.strictEqual(a.maxReeditsOnOneFile, 2);
        // (2 edits - 1 unique file) / 2 edits = 50%.
        assert.strictEqual(a.reworkRatioPct, 50);
    });

    test('tracks the longest consecutive failure streak', () => {
        const a = analyzePerformance(record({
            tools: [
                { name: 'run_in_terminal', phase: 'scaffold', latencyMs: 10, success: false },
                { name: 'run_in_terminal', phase: 'scaffold', latencyMs: 10, success: false },
                { name: 'run_in_terminal', phase: 'scaffold', latencyMs: 10, success: true },
            ],
        }));
        assert.strictEqual(a.longestFailureStreak, 2);
    });

    test('identifies the biggest issue sources', () => {
        const a = analyzePerformance(record());
        assert.strictEqual(a.topFailingTools[0].name, 'run_in_terminal');
        assert.strictEqual(a.topFailingTools[0].failures, 1);
        assert.strictEqual(a.topFailingTools[0].attempts, 2);
        assert.strictEqual(a.failuresByPhase[0].key, 'scaffold');
        assert.strictEqual(a.failuresByCategory[0].key, 'terminal');
    });

    test('identifies bottlenecks by phase, call count, and duration', () => {
        const a = analyzePerformance(record());
        // scaffold has the most tool time (200+300+5000+100) and the most calls.
        assert.strictEqual(a.slowestPhaseByToolTime?.phase, 'scaffold');
        assert.strictEqual(a.busiestPhaseByCalls?.phase, 'scaffold');
        assert.strictEqual(a.longestCall?.name, 'run_in_terminal');
        assert.strictEqual(a.longestCall?.latencyMs, 5_000);
    });

    test('reads friction fields when present', () => {
        const a = analyzePerformance(record({
            friction: { autopilot: false, approvalCount: 2, approvalWaitMs: 4_000, activeMs: 6_000, revisionCount: 3, questionsAsked: 1, safetyTimerFired: false },
        }));
        assert.strictEqual(a.revisionRoundTrips, 3);
        assert.strictEqual(a.approvalWaitMs, 4_000);
        assert.strictEqual(a.activeMs, 6_000);
    });
});
