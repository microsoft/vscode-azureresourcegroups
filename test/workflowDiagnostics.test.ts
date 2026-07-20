/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "assert";
import {
    renderReportMarkdown,
    type WorkflowDiagnosticsRecord,
} from "../src/webviews/copilotOnRails/extension/telemetry/workflowDiagnostics";

function baseRecord(overrides: Partial<WorkflowDiagnosticsRecord> = {}): WorkflowDiagnosticsRecord {
    return {
        sessionId: 'abcdef12-3456-7890-abcd-ef1234567890',
        prompt: 'Build me a todo app with a React frontend and a Node API.',
        startedAt: 1_000,
        endedAt: 61_000,
        outcome: 'completed',
        totalDurationMs: 60_000,
        phases: [
            { phase: 'requirements', agent: 'azure-project-plan', durationMs: 5_000, status: 'completed' },
            { phase: 'plan', agent: 'azure-project-plan', durationMs: 10_000, status: 'completed' },
            { phase: 'scaffold', agent: 'azure-project-scaffold', durationMs: 45_000, status: 'completed' },
            { phase: 'integrate', durationMs: 0, status: 'notReached' },
            { phase: 'debug', durationMs: 0, status: 'notReached' },
            { phase: 'deploy', durationMs: 0, status: 'notReached' },
        ],
        toolCallCount: 3,
        toolFailureCount: 1,
        tools: [
            { name: 'azureResources_getAzureActivityLog', phase: 'scaffold', latencyMs: 120, success: true },
            { name: 'azureResources_getAzureActivityLog', phase: 'scaffold', latencyMs: 90, success: false },
        ],
        ...overrides,
    };
}

suite('workflowDiagnostics report', () => {
    test('includes the captured prompt verbatim', () => {
        const md = renderReportMarkdown(baseRecord());
        assert.ok(md.includes('Build me a todo app with a React frontend and a Node API.'));
    });

    test('shows a placeholder when no prompt was captured', () => {
        const md = renderReportMarkdown(baseRecord({ prompt: undefined }));
        assert.ok(md.includes('No prompt was captured'));
    });

    test('renders every phase with its status and duration', () => {
        const md = renderReportMarkdown(baseRecord());
        assert.ok(md.includes('`requirements`'));
        assert.ok(md.includes('`scaffold`'));
        assert.ok(md.includes('completed'));
        assert.ok(md.includes('not reached'));
    });

    test('reports the failed phase for errored runs', () => {
        const md = renderReportMarkdown(baseRecord({
            outcome: 'errored',
            stoppedAtPhase: 'scaffold',
            error: 'boom',
            phases: [
                { phase: 'requirements', durationMs: 5_000, status: 'completed' },
                { phase: 'plan', durationMs: 10_000, status: 'completed' },
                { phase: 'scaffold', agent: 'azure-project-scaffold', durationMs: 3_000, status: 'active' },
                { phase: 'integrate', durationMs: 0, status: 'notReached' },
                { phase: 'debug', durationMs: 0, status: 'notReached' },
                { phase: 'deploy', durationMs: 0, status: 'notReached' },
            ],
        }));
        assert.ok(md.includes('Where it stopped'));
        assert.ok(md.includes('failed during the `scaffold` phase'));
        assert.ok(md.includes('boom'));
        assert.ok(md.includes('Failed on phase'));
    });

    test('records the stop phase for abandoned runs', () => {
        const md = renderReportMarkdown(baseRecord({ outcome: 'abandoned', stoppedAtPhase: 'integrate' }));
        assert.ok(md.includes('was abandoned during the `integrate` phase'));
    });

    test('renders a tool-call table with outcomes', () => {
        const md = renderReportMarkdown(baseRecord());
        assert.ok(md.includes('## Tool calls by phase'));
        assert.ok(md.includes('azureResources_getAzureActivityLog'));
        assert.ok(md.includes('120 ms'));
    });

    test('groups tool calls under their phase headers in phase order', () => {
        const md = renderReportMarkdown(baseRecord({
            tools: [
                { name: 'read_file', phase: 'plan', latencyMs: 50, success: true },
                { name: 'edit_file', phase: 'scaffold', latencyMs: 200, success: true },
                { name: 'run_in_terminal', phase: 'scaffold', latencyMs: 5_000, success: false },
            ],
        }));
        const planIdx = md.indexOf('### `plan`');
        const scaffoldIdx = md.indexOf('### `scaffold`');
        assert.ok(planIdx >= 0, 'expected a plan phase group');
        assert.ok(scaffoldIdx >= 0, 'expected a scaffold phase group');
        assert.ok(planIdx < scaffoldIdx, 'phase groups should follow workflow order');
        assert.ok(md.includes('read_file'));
        assert.ok(md.includes('run_in_terminal'));
        // Per-phase summary line reflects counts + failures.
        assert.ok(/### `scaffold` — 2 call\(s\), 1 failed/.test(md));
    });

    test('notes that hook install is needed when no tools were captured', () => {
        const md = renderReportMarkdown(baseRecord({ tools: [] }));
        assert.ok(md.includes('No tool calls were recorded'));
        assert.ok(/hooks to be installed/i.test(md));
    });

    test('states that the report is local-only', () => {
        const md = renderReportMarkdown(baseRecord());
        assert.ok(/local-only/i.test(md));
    });

    test('renders environment, friction, tool-efficiency, and quality sections', () => {
        const md = renderReportMarkdown(baseRecord({
            environment: {
                autopilot: true,
                languages: ['TypeScript'],
                hasFrontend: true,
                hasDatabase: false,
                fileCount: 42,
                linesOfCode: 1234,
                dependencyCount: 17,
                requirementCount: 6,
                plannedRouteCount: 5,
            },
            friction: {
                autopilot: true,
                approvalCount: 3,
                approvalWaitMs: 45_000,
                activeMs: 120_000,
                revisionCount: 2,
                questionsAsked: 1,
                safetyTimerFired: false,
            },
            toolStats: {
                total: 10,
                failures: 2,
                p50LatencyMs: 120,
                p95LatencyMs: 5_000,
                retriedCalls: 1,
                terminalFailures: 1,
                uniqueFilesTouched: 4,
                editChurnRatio: 1.5,
                byCategory: { read: 5, edit: 3, terminal: 2 },
            },
            quality: {
                errorDiagnostics: 0,
                warningDiagnostics: 3,
                residualMockMarkers: 2,
                planCompliance: { expected: 2, present: 2, score: 1, details: ['backend: source present', 'frontend: present'] },
            },
        }));
        assert.ok(md.includes('## Run environment'));
        assert.ok(md.includes('Autopilot'));
        assert.ok(md.includes('## Human-in-the-loop'));
        assert.ok(md.includes('Manual approvals'));
        assert.ok(md.includes('## Tool efficiency'));
        assert.ok(md.includes('Latency p50 / p95'));
        assert.ok(md.includes('## Quality signals'));
        assert.ok(md.includes('Plan compliance'));
        assert.ok(md.includes('Residual mock markers'));
    });

    test('lists failed tool calls in a dedicated section', () => {
        const md = renderReportMarkdown(baseRecord({
            tools: [
                { name: 'read_file', phase: 'plan', latencyMs: 50, success: true },
                { name: 'run_in_terminal', phase: 'scaffold', latencyMs: 5_000, success: false },
            ],
        }));
        const failIdx = md.indexOf('## Failed tool calls');
        assert.ok(failIdx >= 0, 'expected a failed tool calls section');
        // The failing terminal call should appear after the section header.
        assert.ok(md.indexOf('run_in_terminal', failIdx) > failIdx);
        assert.ok(md.includes('terminal'));
    });

    test('omits the failed tool calls section when there are no failures', () => {
        const md = renderReportMarkdown(baseRecord({
            toolFailureCount: 0,
            tools: [
                { name: 'read_file', phase: 'plan', latencyMs: 50, success: true },
            ],
        }));
        assert.ok(!md.includes('## Failed tool calls'));
    });

    test('ranks the slowest tool calls', () => {
        const md = renderReportMarkdown(baseRecord({
            tools: [
                { name: 'fast_read', phase: 'plan', latencyMs: 10, success: true },
                { name: 'slow_terminal', phase: 'scaffold', latencyMs: 9_000, success: true },
                { name: 'medium_edit', phase: 'scaffold', latencyMs: 500, success: true },
            ],
        }));
        const slowIdx = md.indexOf('## Slowest tool calls');
        assert.ok(slowIdx >= 0, 'expected a slowest tool calls section');
        // The slowest call should be listed before the faster ones.
        const slowTerminalIdx = md.indexOf('slow_terminal', slowIdx);
        const mediumEditIdx = md.indexOf('medium_edit', slowIdx);
        assert.ok(slowTerminalIdx >= 0 && mediumEditIdx >= 0);
        assert.ok(slowTerminalIdx < mediumEditIdx, 'slowest call should be ranked first');
    });

    test('breaks tool calls down by category per phase', () => {
        const md = renderReportMarkdown(baseRecord({
            tools: [
                { name: 'read_file', phase: 'plan', latencyMs: 50, success: true },
                { name: 'edit_file', phase: 'scaffold', latencyMs: 200, success: true },
                { name: 'run_in_terminal', phase: 'scaffold', latencyMs: 300, success: true },
            ],
        }));
        const catIdx = md.indexOf('## Tool categories by phase');
        assert.ok(catIdx >= 0, 'expected a per-phase category breakdown');
        // Category columns should reflect the tools that were used.
        assert.ok(/read/.test(md.slice(catIdx)));
        assert.ok(/edit/.test(md.slice(catIdx)));
        assert.ok(/terminal/.test(md.slice(catIdx)));
    });

    test('renders a performance analysis with assessment, reliability, and bottlenecks', () => {
        const md = renderReportMarkdown(baseRecord({
            tools: [
                { name: 'read_file', phase: 'plan', latencyMs: 50, success: true },
                { name: 'edit_file', phase: 'scaffold', latencyMs: 200, success: true, targetHash: 'aaa' },
                { name: 'edit_file', phase: 'scaffold', latencyMs: 300, success: true, targetHash: 'aaa' },
                { name: 'run_in_terminal', phase: 'scaffold', latencyMs: 5_000, success: false },
                { name: 'run_in_terminal', phase: 'scaffold', latencyMs: 100, success: true },
            ],
        }));
        assert.ok(md.includes('## Performance analysis'));
        assert.ok(md.includes('### Assessment'));
        assert.ok(md.includes('### Reliability & self-correction'));
        assert.ok(md.includes('Tool success rate'));
        assert.ok(md.includes('### Top issue sources'));
        assert.ok(md.includes('### Bottlenecks'));
        // Self-correction should be surfaced: a retried terminal call and a re-edited file.
        assert.ok(/self-corrected/i.test(md));
    });

    test('omits the performance analysis when no tool calls were captured', () => {
        const md = renderReportMarkdown(baseRecord({ tools: [] }));
        assert.ok(!md.includes('## Performance analysis'));
    });
});
