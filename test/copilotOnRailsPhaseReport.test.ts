/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "assert";
import type { DiagnosticEvent } from "../src/utils/copilotOnRails/copilotOnRailsDiagnosticUtils";
import {
    buildPhaseDurationReport,
    phaseForEventName,
    renderPhaseDurationReportMarkdown,
} from "../src/utils/copilotOnRails/copilotOnRailsPhaseReport";

/** Builds a diagnostic event at a given wall-clock offset (seconds) from a base time. */
function event(name: string, status: DiagnosticEvent['status'], secondsFromBase: number): DiagnosticEvent {
    return {
        name,
        type: name.startsWith('azureResourceGroups.') ? 'extensionCommand' : 'mcpTool',
        status,
        properties: { eventTimestamp: new Date(BASE_MS + secondsFromBase * 1000).toISOString() },
    };
}

const BASE_MS = Date.parse('2026-01-01T00:00:00.000Z');

suite('copilotOnRailsPhaseReport', () => {
    test('phaseForEventName maps command ids and tool names to phases', () => {
        assert.strictEqual(phaseForEventName('azureResourceGroups.openRequirementsView'), 'requirements');
        assert.strictEqual(phaseForEventName('open_requirements_view'), 'requirements');
        assert.strictEqual(phaseForEventName('open_plan_view'), 'plan');
        assert.strictEqual(phaseForEventName('start_project_scaffold'), 'scaffold');
        assert.strictEqual(phaseForEventName('start_project_integrate'), 'integrate');
        assert.strictEqual(phaseForEventName('start_azure_debug_generate'), 'debug');
        assert.strictEqual(phaseForEventName('start_deployment'), 'deploy');
    });

    test('phaseForEventName returns undefined for unknown names', () => {
        assert.strictEqual(phaseForEventName('some_other_tool'), undefined);
        assert.strictEqual(phaseForEventName(''), undefined);
    });

    test('phaseForEventName maps custom-agent launch names to phases', () => {
        assert.strictEqual(phaseForEventName('azure-project-plan'), 'plan');
        assert.strictEqual(phaseForEventName('azure-project-scaffold'), 'scaffold');
        assert.strictEqual(phaseForEventName('azure-project-integrate'), 'integrate');
        assert.strictEqual(phaseForEventName('azure-debug-plan'), 'debug');
        assert.strictEqual(phaseForEventName('azure-debug-generate'), 'debug');
        assert.strictEqual(phaseForEventName('azure-deploy'), 'deploy');
    });

    test('buildPhaseDurationReport spans each phase up to the next phase start', () => {
        // requirements @0s, plan @10s, scaffold @30s, scaffold completes @60s.
        const events: DiagnosticEvent[] = [
            event('open_requirements_view', 'start', 0),
            event('open_requirements_view', 'success', 1),
            event('open_plan_view', 'start', 10),
            event('open_plan_view', 'success', 11),
            event('start_project_scaffold', 'start', 30),
            event('start_project_scaffold', 'success', 60),
        ];

        const report = buildPhaseDurationReport(events);

        assert.deepStrictEqual(report.phases.map((p) => p.phase), ['requirements', 'plan', 'scaffold']);
        // requirements: 0s -> plan start 10s = 10s
        assert.strictEqual(report.phases[0].durationMs, 10_000);
        // plan: 10s -> scaffold start 30s = 20s
        assert.strictEqual(report.phases[1].durationMs, 20_000);
        // scaffold (final): 30s -> its own last event 60s = 30s
        assert.strictEqual(report.phases[2].durationMs, 30_000);
        assert.strictEqual(report.totalDurationMs, 60_000);
    });

    test('buildPhaseDurationReport excludes stale events from a prior run', () => {
        // A stale requirements pair from ~18h earlier, then today's tightly-clustered run.
        const events: DiagnosticEvent[] = [
            event('open_requirements_view', 'start', 0),
            event('open_requirements_view', 'success', 1),
            event('open_plan_view', 'start', 18 * 60 * 60), // 18h later -> new run
            event('open_plan_view', 'success', 18 * 60 * 60 + 2),
            event('start_project_integrate', 'start', 18 * 60 * 60 + 60),
            event('start_project_integrate', 'success', 18 * 60 * 60 + 65),
        ];

        const report = buildPhaseDurationReport(events);

        assert.strictEqual(report.priorRunCount, 1);
        assert.deepStrictEqual(report.phases.map((p) => p.phase), ['plan', 'integrate']);
        // The 18h stale gap must not appear anywhere in the reported duration.
        assert.ok(report.totalDurationMs < 5 * 60 * 1000, `unexpected total duration ${report.totalDurationMs}`);
    });

    test('buildPhaseDurationReport splits active tool time from idle time', () => {
        // A single scaffold call that takes 20s of active tool time inside a 60s phase.
        const events: DiagnosticEvent[] = [
            event('start_project_scaffold', 'start', 0),
            event('start_project_scaffold', 'success', 20),
            event('start_project_integrate', 'start', 60),
        ];

        const report = buildPhaseDurationReport(events);
        const scaffold = report.phases.find((p) => p.phase === 'scaffold');
        assert.ok(scaffold);
        assert.strictEqual(scaffold?.durationMs, 60_000);
        assert.strictEqual(scaffold?.activeToolMs, 20_000);
        assert.strictEqual(scaffold?.idleMs, 40_000);
    });

    test('buildPhaseDurationReport counts calls and failures, not raw events', () => {
        // debug phase: 3 distinct tools, one of which fails -> 6 raw events, 3 calls.
        const events: DiagnosticEvent[] = [
            event('start_local_development', 'start', 0),
            event('start_local_development', 'success', 1),
            event('start_azure_debug_generate', 'start', 5),
            event('start_azure_debug_generate', 'error', 6),
            event('open_local_next_steps_view', 'start', 10),
            event('open_local_next_steps_view', 'success', 11),
        ];

        const report = buildPhaseDurationReport(events);
        const debug = report.phases.find((p) => p.phase === 'debug');
        assert.ok(debug);
        assert.strictEqual(debug?.eventCount, 6);
        assert.strictEqual(debug?.toolCalls, 3);
        assert.strictEqual(debug?.failures, 1);
        assert.strictEqual(debug?.tools.length, 3);
    });

    test('buildPhaseDurationReport reports the slowest phase and slowest call', () => {
        const events: DiagnosticEvent[] = [
            event('open_requirements_view', 'start', 0),
            event('open_requirements_view', 'success', 2),
            event('start_project_scaffold', 'start', 10),
            event('start_project_scaffold', 'success', 50),
        ];

        const report = buildPhaseDurationReport(events);
        assert.strictEqual(report.slowestPhase?.phase, 'scaffold');
        assert.strictEqual(report.slowestCall?.name, 'start_project_scaffold');
        assert.strictEqual(report.slowestCall?.phase, 'scaffold');
        assert.strictEqual(report.slowestCall?.latencyMs, 40_000);
    });

    test('buildPhaseDurationReport counts retries after a failure of the same tool', () => {
        const events: DiagnosticEvent[] = [
            event('start_project_scaffold', 'start', 0),
            event('start_project_scaffold', 'error', 1),
            event('start_project_scaffold', 'start', 2), // retry after failure
            event('start_project_scaffold', 'success', 3),
        ];

        const report = buildPhaseDurationReport(events);
        const scaffold = report.phases.find((p) => p.phase === 'scaffold');
        assert.strictEqual(scaffold?.retriedCalls, 1);
        assert.strictEqual(report.totalRetriedCalls, 1);
    });

    test('buildPhaseDurationReport tracks the longest consecutive failure streak', () => {
        const events: DiagnosticEvent[] = [
            event('start_project_scaffold', 'start', 0),
            event('start_project_scaffold', 'error', 1),
            event('start_project_scaffold', 'start', 2),
            event('start_project_scaffold', 'error', 3),
            event('start_project_scaffold', 'start', 4),
            event('start_project_scaffold', 'success', 5), // resets the streak
        ];

        const report = buildPhaseDurationReport(events);
        assert.strictEqual(report.maxFailureStreak, 2);
        assert.strictEqual(report.phases[0].maxFailureStreak, 2);
    });

    test('buildPhaseDurationReport counts phase revisits as revision round-trips', () => {
        const events: DiagnosticEvent[] = [
            event('open_plan_view', 'start', 0),
            event('start_project_scaffold', 'start', 10),
            event('open_plan_view', 'start', 20), // back to plan -> revisit
            event('open_plan_view', 'success', 21),
        ];

        const report = buildPhaseDurationReport(events);
        const plan = report.phases.find((p) => p.phase === 'plan');
        assert.strictEqual(plan?.revisits, 1);
        assert.strictEqual(report.revisitCount, 1);
    });

    test('buildPhaseDurationReport records spin-up latency and phase transitions', () => {
        const events: DiagnosticEvent[] = [
            event('open_requirements_view', 'start', 0),
            event('open_requirements_view', 'success', 2),
            event('open_plan_view', 'start', 30), // 28s after requirements' last event
        ];

        const report = buildPhaseDurationReport(events);
        const plan = report.phases.find((p) => p.phase === 'plan');
        assert.strictEqual(plan?.spinUpMs, 28_000);
        assert.strictEqual(report.transitions.length, 1);
        assert.deepStrictEqual(
            { from: report.transitions[0].from, to: report.transitions[0].to, gapMs: report.transitions[0].gapMs },
            { from: 'requirements', to: 'plan', gapMs: 28_000 },
        );
    });

    test('buildPhaseDurationReport records the longest unobserved gap within a phase', () => {
        const events: DiagnosticEvent[] = [
            event('start_local_development', 'start', 0),
            event('start_local_development', 'success', 1),
            event('start_azure_debug_generate', 'start', 45), // 44s gap of hidden work
            event('start_azure_debug_generate', 'success', 46),
        ];

        const report = buildPhaseDurationReport(events);
        const debug = report.phases.find((p) => p.phase === 'debug');
        assert.strictEqual(debug?.longestGapMs, 44_000);
    });

    test('buildPhaseDurationReport preserves workflow phase ordering regardless of input order', () => {
        const events: DiagnosticEvent[] = [
            event('start_project_scaffold', 'start', 30),
            event('open_requirements_view', 'start', 0),
            event('open_plan_view', 'start', 10),
        ];

        const report = buildPhaseDurationReport(events);
        assert.deepStrictEqual(report.phases.map((p) => p.phase), ['requirements', 'plan', 'scaffold']);
    });

    test('buildPhaseDurationReport marks a phase completed on success and open otherwise', () => {
        const completed = buildPhaseDurationReport([
            event('open_requirements_view', 'start', 0),
            event('open_requirements_view', 'success', 1),
        ]);
        assert.strictEqual(completed.phases[0].completed, true);

        const inProgress = buildPhaseDurationReport([
            event('open_requirements_view', 'start', 0),
        ]);
        assert.strictEqual(inProgress.phases[0].completed, false);
    });

    test('buildPhaseDurationReport counts unmapped events without attributing them', () => {
        const report = buildPhaseDurationReport([
            event('open_requirements_view', 'start', 0),
            event('some_other_tool', 'start', 5),
        ]);
        assert.strictEqual(report.unmappedEventCount, 1);
        assert.strictEqual(report.phases.length, 1);
    });

    test('buildPhaseDurationReport surfaces scaffold as a distinct phase from an agent-launch event', () => {
        // Webview plan-approval path: plan view, then the scaffold agent is
        // launched directly (no `start_project_scaffold` command), then integrate.
        const report = buildPhaseDurationReport([
            event('open_plan_view', 'start', 0),
            event('open_plan_view', 'success', 1),
            event('azure-project-scaffold', 'start', 20),
            event('azure-project-integrate', 'start', 200),
        ]);
        const phases = report.phases.map((p) => p.phase);
        assert.deepStrictEqual(phases, ['plan', 'scaffold', 'integrate']);
        const scaffold = report.phases.find((p) => p.phase === 'scaffold');
        assert.ok(scaffold);
        // Scaffold spans from its launch (20s) to integrate's launch (200s) = 180s.
        assert.strictEqual(scaffold?.durationMs, 180_000);
    });

    test('buildPhaseDurationReport returns an empty report for no events', () => {
        const report = buildPhaseDurationReport([]);
        assert.strictEqual(report.phases.length, 0);
        assert.strictEqual(report.totalDurationMs, 0);
        assert.strictEqual(report.startedAt, undefined);
        assert.strictEqual(report.endedAt, undefined);
    });

    test('renderPhaseDurationReportMarkdown includes a row per active phase', () => {
        const md = renderPhaseDurationReportMarkdown(buildPhaseDurationReport([
            event('open_requirements_view', 'start', 0),
            event('open_plan_view', 'start', 10),
            event('open_plan_view', 'success', 12),
        ]));
        assert.ok(md.includes('# Copilot on Rails — Phase Durations'));
        assert.ok(md.includes('| requirements |'));
        assert.ok(md.includes('| plan |'));
    });

    test('renderPhaseDurationReportMarkdown handles an empty report', () => {
        const md = renderPhaseDurationReportMarkdown(buildPhaseDurationReport([]));
        assert.ok(md.includes('No Copilot on Rails phase activity'));
    });

    test('buildPhaseDurationReport merges live friction when provided', () => {
        const report = buildPhaseDurationReport([
            event('open_requirements_view', 'start', 0),
            event('open_plan_view', 'start', 10),
            event('open_plan_view', 'success', 12),
        ], { friction: { autopilot: true, approvalCount: 2, approvalWaitMs: 45_000, revisionCount: 1, safetyTimerFired: false } });
        assert.ok(report.friction);
        assert.strictEqual(report.friction?.approvalCount, 2);
        assert.strictEqual(report.friction?.approvalWaitMs, 45_000);
        assert.strictEqual(report.friction?.revisionCount, 1);
        assert.strictEqual(report.friction?.autopilot, true);
    });

    test('buildPhaseDurationReport leaves friction undefined by default', () => {
        const report = buildPhaseDurationReport([
            event('open_requirements_view', 'start', 0),
        ]);
        assert.strictEqual(report.friction, undefined);
    });

    test('renderPhaseDurationReportMarkdown renders a Friction section when present', () => {
        const md = renderPhaseDurationReportMarkdown(buildPhaseDurationReport([
            event('open_requirements_view', 'start', 0),
            event('open_plan_view', 'start', 10),
            event('open_plan_view', 'success', 12),
        ], { friction: { autopilot: false, approvalCount: 3, approvalWaitMs: 90_000, revisionCount: 2, safetyTimerFired: true } }));
        assert.ok(md.includes('## Friction (live run)'));
        assert.ok(md.includes('Approval gates cleared:** 3'));
        assert.ok(md.includes('Time awaiting approval:**'));
        assert.ok(md.includes('Revision round-trips:** 2'));
        assert.ok(md.includes('Safety timer:** fired'));
    });

    test('renderPhaseDurationReportMarkdown omits the Friction section without friction', () => {
        const md = renderPhaseDurationReportMarkdown(buildPhaseDurationReport([
            event('open_requirements_view', 'start', 0),
            event('open_plan_view', 'start', 10),
            event('open_plan_view', 'success', 12),
        ]));
        assert.ok(!md.includes('## Friction (live run)'));
    });
});
