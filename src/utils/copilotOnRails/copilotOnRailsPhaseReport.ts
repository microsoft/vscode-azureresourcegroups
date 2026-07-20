/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { WorkflowPhase } from "../../webviews/copilotOnRails/extension/telemetry/workflowTelemetry";
import type { DiagnosticEvent } from "./copilotOnRailsDiagnosticUtils";

/**
 * Property key holding each event's ISO 8601 record time inside
 * {@link DiagnosticEvent.properties}. Mirrors `eventTimestampProperty` in
 * `copilotOnRailsDiagnosticUtils`; kept as a local literal so this module stays a
 * pure, dependency-free builder (no runtime import of the recorder).
 */
const EVENT_TIMESTAMP_PROPERTY = 'eventTimestamp';

/** Reads a diagnostic event's record time (from `properties.eventTimestamp`) as epoch ms, or `NaN` when absent/invalid. */
function eventTimeMs(event: DiagnosticEvent): number {
    const ts: unknown = event.properties?.[EVENT_TIMESTAMP_PROPERTY];
    return typeof ts === 'string' ? Date.parse(ts) : NaN;
}

/**
 * Ordered list of the workflow phases the create-project journey moves through.
 * Kept local (rather than importing the runtime constant) so this module stays a
 * pure, dependency-free builder that is trivial to unit test.
 */
const PHASE_ORDER: readonly WorkflowPhase[] = ['requirements', 'plan', 'scaffold', 'integrate', 'debug', 'deploy'];

/**
 * Maps each Copilot on Rails event name to the workflow phase it belongs to.
 *
 * Both extension-command ids (`azureResourceGroups.*`) and MCP tool names
 * (`open_*` / `start_*`) drive the same phases, so both are listed here. The
 * strings mirror `copilotOnRailsCommandIds` and the individual `*ToolName`
 * constants; keep them in sync if those are renamed.
 *
 * Custom-agent names (`azure-*`) are also mapped: a phase's real work happens
 * inside a handed-off chat agent that isn't otherwise instrumented, and several
 * entry paths (webview plan-approval, resume) launch those agents directly
 * without going through a `start_*` command. Recording the agent launch keyed by
 * name guarantees every phase shows up regardless of how it was entered. These
 * mirror the `azure*Agent` constants in `constants.ts`; keep them in sync.
 */
const EVENT_NAME_TO_PHASE: Readonly<Record<string, WorkflowPhase>> = {
    // requirements
    'azureResourceGroups.openRequirementsView': 'requirements',
    'open_requirements_view': 'requirements',

    // plan
    'azureResourceGroups.openPlanView': 'plan',
    'open_plan_view': 'plan',
    'azureResourceGroups.openLocalPlanView': 'plan',
    'open_local_plan_view': 'plan',

    // scaffold
    'azureResourceGroups.startProjectScaffold': 'scaffold',
    'start_project_scaffold': 'scaffold',
    'azureResourceGroups.openFrontendPreviewView': 'scaffold',
    'open_frontend_preview_view': 'scaffold',
    'azureResourceGroups.openScaffoldNextStepsView': 'scaffold',
    'open_scaffold_next_steps_view': 'scaffold',

    // integrate
    'azureResourceGroups.startProjectIntegrate': 'integrate',
    'start_project_integrate': 'integrate',

    // debug
    'azureResourceGroups.startLocalDevelopment': 'debug',
    'start_local_development': 'debug',
    'azureResourceGroups.startAzureDebugGenerate': 'debug',
    'start_azure_debug_generate': 'debug',
    'azureResourceGroups.openLocalNextStepsView': 'debug',
    'azureResourceGroups.debug.openLocalNextStepsView': 'debug',
    'open_local_next_steps_view': 'debug',
    'azureResourceGroups.startDebugConfiguration': 'debug',

    // deploy
    'azureResourceGroups.startDeployment': 'deploy',
    'start_deployment': 'deploy',
    'azureResourceGroups.openDeployPlanView': 'deploy',
    'open_deploy_plan_view': 'deploy',

    // custom-agent launches (any entry path; mirrors the `azure*Agent` constants)
    'azure-project-plan': 'plan',
    'azure-project-scaffold': 'scaffold',
    'azure-project-integrate': 'integrate',
    'azure-debug-plan': 'debug',
    'azure-debug-generate': 'debug',
    'azure-deploy': 'deploy',
};

/** Maps an event name (command id or MCP tool name) to its workflow phase, if any. */
export function phaseForEventName(name: string): WorkflowPhase | undefined {
    return EVENT_NAME_TO_PHASE[name];
}

/** Per-phase duration computed from the recorded start/complete events. */
/**
 * A gap of at least this many milliseconds between two consecutive events is
 * treated as a boundary between separate runs. This keeps a stale event left
 * over from a previous session (e.g. an old `requirements` handoff from the day
 * before) from being stitched onto the current run and inflating its duration.
 */
export const NEW_RUN_GAP_MS = 60 * 60 * 1000; // 1 hour

/** Per-tool usage within a phase, so a phase's raw event count is explainable. */
export interface PhaseToolBreakdown {
    /** Event name (command id or MCP tool name). */
    name: string;
    /** Number of `start` events (i.e. invocations). */
    calls: number;
    /** Number of `error` completions. */
    failures: number;
    /** Sum of matched start→complete latencies, in milliseconds. */
    totalLatencyMs: number;
}

export interface PhaseDurationEntry {
    phase: WorkflowPhase;
    /** ISO 8601 timestamp of the first event attributed to this phase. */
    startedAt: string;
    /** ISO 8601 timestamp marking the end of this phase (when the next phase began, or the phase's last event). */
    endedAt: string;
    /** Wall-clock time spent in this phase, in milliseconds. */
    durationMs: number;
    /** Number of tool/command invocations (`start` events) in this phase. */
    toolCalls: number;
    /** Number of failed completions (`error` events) in this phase. */
    failures: number;
    /** Number of raw diagnostic events attributed to this phase (starts + completions). */
    eventCount: number;
    /** Sum of matched start→complete latencies — the time actually spent running tools. */
    activeToolMs: number;
    /** Wall-clock time in the phase not accounted for by tool execution (think/approval/handoff time). */
    idleMs: number;
    /** Number of invocations of a tool that had already failed earlier in the phase (retries after failure). */
    retriedCalls: number;
    /** Longest run of consecutive failed completions within the phase. */
    maxFailureStreak: number;
    /** Number of times this phase was re-entered after moving on (revision round-trips). */
    revisits: number;
    /** Largest gap between two consecutive recorded events in the phase — the biggest block of unobserved work/think time. */
    longestGapMs: number;
    /** Time from the previous phase's last activity until this phase's first tool call (agent spin-up / handoff). */
    spinUpMs?: number;
    /** The single slowest tool call in this phase, if any completed. */
    longestCall?: { name: string; latencyMs: number };
    /** Per-tool breakdown, most-invoked first. */
    tools: PhaseToolBreakdown[];
    /** Whether the phase closed with a `success`/`error` event or was superseded by a later phase. */
    completed: boolean;
}

/** A handoff from one phase to the next, and how long the agent took to make its first call in the new phase. */
export interface PhaseTransition {
    from: WorkflowPhase;
    to: WorkflowPhase;
    /** Gap between the previous phase's last activity and the next phase's first event, in milliseconds. */
    gapMs: number;
}

/**
 * Category 4 (friction) counters sourced from the live workflow-telemetry session
 * record. Available only while a run is in progress (best-effort), since the
 * underlying record is cleared when the run finalizes.
 */
export interface WorkflowFriction {
    autopilot: boolean;
    /** Number of approval gates the user cleared. */
    approvalCount: number;
    /** Total time spent waiting on human approval, in milliseconds (a subset of idle time). */
    approvalWaitMs: number;
    /** Number of feedback/revision round-trips recorded within phases. */
    revisionCount: number;
    /** Whether the run's safety timer fired (a stall guard). */
    safetyTimerFired: boolean;
}

/** Optional inputs that augment the report beyond what the event stream provides. */
export interface BuildPhaseDurationReportOptions {
    /** Live friction counters, if a run is currently active. */
    friction?: WorkflowFriction;
}

/** A per-phase duration report derived from the workspace-cached diagnostic events. */
export interface PhaseDurationReport {
    /** Phases that saw activity in the most recent run, in workflow order. */
    phases: PhaseDurationEntry[];
    /** Sum of all per-phase durations, in milliseconds. */
    totalDurationMs: number;
    /** Total time spent actively running tools across the run. */
    totalActiveToolMs: number;
    /** Total idle time (duration minus active tool time) across the run. */
    totalIdleMs: number;
    /** ISO 8601 timestamp of the earliest phase event in the run, if any. */
    startedAt?: string;
    /** ISO 8601 timestamp of the latest phase event in the run, if any. */
    endedAt?: string;
    /** Number of events in the run that could not be attributed to a workflow phase. */
    unmappedEventCount: number;
    /** Number of earlier runs excluded from this report (only the latest run is shown). */
    priorRunCount: number;
    /** The phase with the greatest wall-clock duration, for quick bottleneck spotting. */
    slowestPhase?: { phase: WorkflowPhase; durationMs: number };
    /** The slowest individual tool call across the run. */
    slowestCall?: { name: string; phase: WorkflowPhase; latencyMs: number };
    /** Per-transition handoff latency between consecutive phases. */
    transitions: PhaseTransition[];
    /** Total retries-after-failure across the run. */
    totalRetriedCalls: number;
    /** Longest run of consecutive failed completions across the whole run. */
    maxFailureStreak: number;
    /** Total number of phase re-entries (revision round-trips) across the run. */
    revisitCount: number;
    /**
     * Live friction counters merged from the workflow-telemetry session, when a
     * run is active. Absent for historical reports (the source record is cleared
     * on finalize). Note: {@link WorkflowFriction.approvalWaitMs} is a subset of
     * {@link totalIdleMs}.
     */
    friction?: WorkflowFriction;
}

interface PhaseSegment {
    phase: WorkflowPhase;
    startMs: number;
    endMs: number;
    events: DiagnosticEvent[];
    lastStatus?: DiagnosticEvent['status'];
}

interface SegmentMetrics {
    activeToolMs: number;
    toolCalls: number;
    failures: number;
    retriedCalls: number;
    maxFailureStreak: number;
    longestGapMs: number;
    longestCall?: { name: string; latencyMs: number };
    tools: PhaseToolBreakdown[];
}

/**
 * Builds a per-phase duration report from the recorded start/complete diagnostic
 * events.
 *
 * Only the most recent run is reported: events are first split into runs wherever
 * a gap of {@link NEW_RUN_GAP_MS} or more appears, so a stale leftover event from
 * an earlier session can't inflate the current run's durations. Within the run, a
 * phase spans from its first event until the next phase begins (capturing in-phase
 * work time, not just the near-instant handoff calls); the final phase spans up to
 * its own last recorded event.
 *
 * Pure and dependency-free so it can be unit tested in isolation.
 */
export function buildPhaseDurationReport(events: readonly DiagnosticEvent[], options?: BuildPhaseDurationReportOptions): PhaseDurationReport {
    const timed: DiagnosticEvent[] = events
        .filter((e) => !Number.isNaN(eventTimeMs(e)))
        .slice()
        .sort((a, b) => eventTimeMs(a) - eventTimeMs(b));

    // Split into runs on large inter-event gaps, then keep only the latest run.
    const runs: DiagnosticEvent[][] = [];
    let currentRun: DiagnosticEvent[] = [];
    let prevMs: number | undefined;
    for (const event of timed) {
        const ms: number = eventTimeMs(event);
        if (prevMs !== undefined && ms - prevMs >= NEW_RUN_GAP_MS) {
            runs.push(currentRun);
            currentRun = [];
        }
        currentRun.push(event);
        prevMs = ms;
    }
    if (currentRun.length) {
        runs.push(currentRun);
    }

    const priorRunCount: number = Math.max(0, runs.length - 1);
    const runEvents: DiagnosticEvent[] = runs.length ? runs[runs.length - 1] : [];

    // Build contiguous phase segments within the run.
    let unmappedEventCount = 0;
    const segments: PhaseSegment[] = [];
    for (const event of runEvents) {
        const phase: WorkflowPhase | undefined = phaseForEventName(event.name);
        if (!phase) {
            unmappedEventCount++;
            continue;
        }

        const ms: number = eventTimeMs(event);
        const current: PhaseSegment | undefined = segments[segments.length - 1];
        if (current && current.phase === phase) {
            current.endMs = ms;
            current.events.push(event);
            current.lastStatus = event.status;
        } else {
            segments.push({ phase, startMs: ms, endMs: ms, events: [event], lastStatus: event.status });
        }
    }

    // Extend each phase up to the moment the next phase began so the reported
    // duration reflects the time actually spent working within the phase.
    for (let i = 0; i < segments.length - 1; i++) {
        segments[i].endMs = segments[i + 1].startMs;
    }

    // Aggregate segments by phase (phases are normally sequential, but a phase
    // could be revisited; summing keeps the totals honest either way).
    const byPhase = new Map<WorkflowPhase, PhaseDurationEntry>();
    const segmentCountByPhase = new Map<WorkflowPhase, number>();
    for (let i = 0; i < segments.length; i++) {
        const seg: PhaseSegment = segments[i];
        const durationMs: number = Math.max(0, seg.endMs - seg.startMs);
        const isLastSegment: boolean = i === segments.length - 1;
        const completed: boolean = !isLastSegment || seg.lastStatus === 'success' || seg.lastStatus === 'error';
        const metrics: SegmentMetrics = computeSegmentMetrics(seg.events);
        segmentCountByPhase.set(seg.phase, (segmentCountByPhase.get(seg.phase) ?? 0) + 1);

        // Spin-up: time from the previous phase's last activity to this phase's first event.
        const spinUpMs: number | undefined = i > 0 ? Math.max(0, seg.startMs - lastRawEventMs(segments[i - 1])) : undefined;

        const existing: PhaseDurationEntry | undefined = byPhase.get(seg.phase);
        if (existing) {
            existing.durationMs += durationMs;
            existing.eventCount += seg.events.length;
            existing.toolCalls += metrics.toolCalls;
            existing.failures += metrics.failures;
            existing.activeToolMs += metrics.activeToolMs;
            existing.retriedCalls += metrics.retriedCalls;
            existing.maxFailureStreak = Math.max(existing.maxFailureStreak, metrics.maxFailureStreak);
            existing.longestGapMs = Math.max(existing.longestGapMs, metrics.longestGapMs);
            existing.endedAt = new Date(seg.endMs).toISOString();
            existing.completed = existing.completed || completed;
            existing.tools = mergeToolBreakdowns(existing.tools, metrics.tools);
            existing.longestCall = maxCall(existing.longestCall, metrics.longestCall);
        } else {
            byPhase.set(seg.phase, {
                phase: seg.phase,
                startedAt: new Date(seg.startMs).toISOString(),
                endedAt: new Date(seg.endMs).toISOString(),
                durationMs,
                toolCalls: metrics.toolCalls,
                failures: metrics.failures,
                eventCount: seg.events.length,
                activeToolMs: metrics.activeToolMs,
                idleMs: 0, // finalized below
                retriedCalls: metrics.retriedCalls,
                maxFailureStreak: metrics.maxFailureStreak,
                revisits: 0, // finalized below
                longestGapMs: metrics.longestGapMs,
                spinUpMs,
                longestCall: metrics.longestCall,
                tools: metrics.tools,
                completed,
            });
        }
    }

    const phases: PhaseDurationEntry[] = PHASE_ORDER
        .filter((p) => byPhase.has(p))
        .map((p) => byPhase.get(p) as PhaseDurationEntry);

    for (const p of phases) {
        p.idleMs = Math.max(0, p.durationMs - p.activeToolMs);
        p.revisits = Math.max(0, (segmentCountByPhase.get(p.phase) ?? 1) - 1);
    }

    // Handoff latency between each consecutive pair of phase segments.
    const transitions: PhaseTransition[] = [];
    for (let i = 1; i < segments.length; i++) {
        transitions.push({
            from: segments[i - 1].phase,
            to: segments[i].phase,
            gapMs: Math.max(0, segments[i].startMs - lastRawEventMs(segments[i - 1])),
        });
    }

    const totalDurationMs: number = phases.reduce((sum, p) => sum + p.durationMs, 0);
    const totalActiveToolMs: number = phases.reduce((sum, p) => sum + p.activeToolMs, 0);
    const totalIdleMs: number = phases.reduce((sum, p) => sum + p.idleMs, 0);
    const totalRetriedCalls: number = phases.reduce((sum, p) => sum + p.retriedCalls, 0);
    const revisitCount: number = phases.reduce((sum, p) => sum + p.revisits, 0);
    const maxFailureStreak: number = longestFailureStreak(runEvents);
    const startedAt: string | undefined = segments.length ? new Date(segments[0].startMs).toISOString() : undefined;
    const endedAt: string | undefined = segments.length ? new Date(segments[segments.length - 1].endMs).toISOString() : undefined;

    let slowestPhase: PhaseDurationReport['slowestPhase'];
    let slowestCall: PhaseDurationReport['slowestCall'];
    for (const p of phases) {
        if (!slowestPhase || p.durationMs > slowestPhase.durationMs) {
            slowestPhase = { phase: p.phase, durationMs: p.durationMs };
        }
        if (p.longestCall && (!slowestCall || p.longestCall.latencyMs > slowestCall.latencyMs)) {
            slowestCall = { name: p.longestCall.name, phase: p.phase, latencyMs: p.longestCall.latencyMs };
        }
    }

    return {
        phases, totalDurationMs, totalActiveToolMs, totalIdleMs, startedAt, endedAt,
        unmappedEventCount, priorRunCount, slowestPhase, slowestCall,
        transitions, totalRetriedCalls, maxFailureStreak, revisitCount,
        friction: options?.friction,
    };
}

/** Returns the epoch-ms timestamp of the last raw event recorded in a segment. */
function lastRawEventMs(segment: PhaseSegment): number {
    const last: DiagnosticEvent = segment.events[segment.events.length - 1];
    return eventTimeMs(last);
}

/** Longest run of consecutive `error` completions across an ordered event list (ignoring `start` events). */
function longestFailureStreak(events: readonly DiagnosticEvent[]): number {
    let longest = 0;
    let current = 0;
    for (const event of events) {
        if (event.status === 'error') {
            current++;
            longest = Math.max(longest, current);
        } else if (event.status === 'success') {
            current = 0;
        }
    }
    return longest;
}

/**
 * Pairs `start` events with their matching `success`/`error` completions to derive
 * per-call latency, active tool time, invocation/failure counts, and a per-tool
 * breakdown for a single phase segment.
 */
function computeSegmentMetrics(events: readonly DiagnosticEvent[]): SegmentMetrics {
    const openStarts = new Map<string, number[]>();
    const toolMap = new Map<string, PhaseToolBreakdown>();
    const failedNames = new Set<string>();
    let activeToolMs = 0;
    let toolCalls = 0;
    let failures = 0;
    let retriedCalls = 0;
    let maxFailureStreak = 0;
    let failureStreak = 0;
    let longestGapMs = 0;
    let prevEventMs: number | undefined;
    let longestCall: { name: string; latencyMs: number } | undefined;

    const tool = (name: string): PhaseToolBreakdown => {
        let entry: PhaseToolBreakdown | undefined = toolMap.get(name);
        if (!entry) {
            entry = { name, calls: 0, failures: 0, totalLatencyMs: 0 };
            toolMap.set(name, entry);
        }
        return entry;
    };

    for (const event of events) {
        const ms: number = eventTimeMs(event);
        if (prevEventMs !== undefined) {
            longestGapMs = Math.max(longestGapMs, ms - prevEventMs);
        }
        prevEventMs = ms;

        if (event.status === 'start') {
            toolCalls++;
            tool(event.name).calls++;
            if (failedNames.has(event.name)) {
                retriedCalls++;
            }
            const stack: number[] = openStarts.get(event.name) ?? [];
            stack.push(ms);
            openStarts.set(event.name, stack);
        } else if (event.status === 'success' || event.status === 'error') {
            if (event.status === 'error') {
                failures++;
                failureStreak++;
                maxFailureStreak = Math.max(maxFailureStreak, failureStreak);
                failedNames.add(event.name);
                tool(event.name).failures++;
            } else {
                failureStreak = 0;
            }
            const startMs: number | undefined = openStarts.get(event.name)?.pop();
            if (typeof startMs === 'number') {
                const latencyMs: number = Math.max(0, ms - startMs);
                activeToolMs += latencyMs;
                tool(event.name).totalLatencyMs += latencyMs;
                if (!longestCall || latencyMs > longestCall.latencyMs) {
                    longestCall = { name: event.name, latencyMs };
                }
            }
        }
    }

    const tools: PhaseToolBreakdown[] = Array.from(toolMap.values())
        .sort((a, b) => b.calls - a.calls || b.totalLatencyMs - a.totalLatencyMs || a.name.localeCompare(b.name));
    return { activeToolMs, toolCalls, failures, retriedCalls, maxFailureStreak, longestGapMs, longestCall, tools };
}

/** Merges two per-tool breakdown lists, summing shared entries. */
function mergeToolBreakdowns(a: readonly PhaseToolBreakdown[], b: readonly PhaseToolBreakdown[]): PhaseToolBreakdown[] {
    const merged = new Map<string, PhaseToolBreakdown>();
    for (const list of [a, b]) {
        for (const t of list) {
            const existing: PhaseToolBreakdown | undefined = merged.get(t.name);
            if (existing) {
                existing.calls += t.calls;
                existing.failures += t.failures;
                existing.totalLatencyMs += t.totalLatencyMs;
            } else {
                merged.set(t.name, { ...t });
            }
        }
    }
    return Array.from(merged.values())
        .sort((x, y) => y.calls - x.calls || y.totalLatencyMs - x.totalLatencyMs || x.name.localeCompare(y.name));
}

/** Returns whichever call has the larger latency. */
function maxCall(a: { name: string; latencyMs: number } | undefined, b: { name: string; latencyMs: number } | undefined): { name: string; latencyMs: number } | undefined {
    if (!a) { return b; }
    if (!b) { return a; }
    return b.latencyMs > a.latencyMs ? b : a;
}

/** Formats a millisecond duration as a compact, human-readable string. */
function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms} ms`;
    }
    const totalSeconds: number = Math.round(ms / 1000);
    const minutes: number = Math.floor(totalSeconds / 60);
    const seconds: number = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** Renders a {@link PhaseDurationReport} as Markdown for display. */
export function renderPhaseDurationReportMarkdown(report: PhaseDurationReport): string {
    const lines: string[] = [];
    lines.push('# Copilot on Rails — Phase Durations', '');

    if (report.phases.length === 0) {
        lines.push('_No Copilot on Rails phase activity has been recorded for this workspace yet._', '');
        return lines.join('\n');
    }

    if (report.startedAt) {
        lines.push(`- **Started:** ${report.startedAt}`);
    }
    if (report.endedAt) {
        lines.push(`- **Ended:** ${report.endedAt}`);
    }
    lines.push(`- **Total tracked duration:** ${formatDuration(report.totalDurationMs)}`);
    lines.push(`- **Active tool time:** ${formatDuration(report.totalActiveToolMs)}`);
    lines.push(`- **Idle time (think / approval / handoff):** ${formatDuration(report.totalIdleMs)}`);
    if (report.totalRetriedCalls > 0) {
        lines.push(`- **Retries after failure:** ${report.totalRetriedCalls}`);
    }
    if (report.maxFailureStreak > 0) {
        lines.push(`- **Longest failure streak:** ${report.maxFailureStreak}`);
    }
    if (report.revisitCount > 0) {
        lines.push(`- **Revision round-trips:** ${report.revisitCount}`);
    }
    lines.push('');

    lines.push(
        '| Phase | Duration | Active | Idle | Calls | Retries | Failures | Status |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const p of report.phases) {
        lines.push(`| ${p.phase} | ${formatDuration(p.durationMs)} | ${formatDuration(p.activeToolMs)} | ${formatDuration(p.idleMs)} | ${p.toolCalls} | ${p.retriedCalls} | ${p.failures} | ${p.completed ? 'completed' : 'in progress'} |`);
    }
    lines.push('');

    if (report.slowestPhase || report.slowestCall) {
        lines.push('## Bottlenecks', '');
        if (report.slowestPhase) {
            lines.push(`- **Slowest phase:** ${report.slowestPhase.phase} (${formatDuration(report.slowestPhase.durationMs)})`);
        }
        if (report.slowestCall) {
            lines.push(`- **Slowest tool call:** \`${report.slowestCall.name}\` in ${report.slowestCall.phase} (${formatDuration(report.slowestCall.latencyMs)})`);
        }
        const biggestGap = report.phases.reduce<PhaseDurationEntry | undefined>((max, p) => (!max || p.longestGapMs > max.longestGapMs ? p : max), undefined);
        if (biggestGap && biggestGap.longestGapMs > 0) {
            lines.push(`- **Largest unobserved gap:** ${formatDuration(biggestGap.longestGapMs)} in ${biggestGap.phase}`);
        }
        lines.push('');
    }

    if (report.friction) {
        const f = report.friction;
        lines.push('## Friction (live run)', '');
        lines.push('_Sourced from the in-progress workflow session; unavailable once the run finalizes._', '');
        lines.push(`- **Autopilot:** ${f.autopilot ? 'on' : 'off'}`);
        lines.push(`- **Approval gates cleared:** ${f.approvalCount}`);
        lines.push(`- **Time awaiting approval:** ${formatDuration(f.approvalWaitMs)}${report.totalIdleMs > 0 ? ` (of ${formatDuration(report.totalIdleMs)} idle)` : ''}`);
        lines.push(`- **Revision round-trips:** ${f.revisionCount}`);
        if (f.safetyTimerFired) {
            lines.push('- **Safety timer:** fired (run stalled past its deadline)');
        }
        lines.push('');
    }

    if (report.transitions.length > 0) {
        lines.push('## Phase transitions (handoff latency)', '');
        lines.push('| From | To | Spin-up |', '| --- | --- | --- |');
        for (const t of report.transitions) {
            lines.push(`| ${t.from} | ${t.to} | ${formatDuration(t.gapMs)} |`);
        }
        lines.push('');
    }

    const phasesWithDetail = report.phases.filter((p) => p.tools.length > 0);
    if (phasesWithDetail.length > 0) {
        lines.push('## Phase details', '');
        for (const p of phasesWithDetail) {
            lines.push(`### ${p.phase}`);
            const facts: string[] = [];
            if (typeof p.spinUpMs === 'number') { facts.push(`spin-up ${formatDuration(p.spinUpMs)}`); }
            if (p.longestGapMs > 0) { facts.push(`longest gap ${formatDuration(p.longestGapMs)}`); }
            if (p.retriedCalls > 0) { facts.push(`${p.retriedCalls} retr${p.retriedCalls === 1 ? 'y' : 'ies'}`); }
            if (p.maxFailureStreak > 0) { facts.push(`failure streak ${p.maxFailureStreak}`); }
            if (p.revisits > 0) { facts.push(`${p.revisits} revisit${p.revisits === 1 ? '' : 's'}`); }
            if (facts.length > 0) {
                lines.push(`_${facts.join(' · ')}_`, '');
            }
            for (const t of p.tools) {
                const failureNote: string = t.failures > 0 ? `, ${t.failures} failed` : '';
                lines.push(`- \`${t.name}\` — ${t.calls} call${t.calls === 1 ? '' : 's'}${failureNote} (${formatDuration(t.totalLatencyMs)})`);
            }
            lines.push('');
        }
    }

    if (report.priorRunCount > 0) {
        lines.push(`_${report.priorRunCount} earlier run(s) were detected and excluded; only the most recent run is shown._`, '');
    }
    if (report.unmappedEventCount > 0) {
        lines.push(`_${report.unmappedEventCount} event(s) in this run were not attributable to a workflow phase and are excluded._`, '');
    }

    return lines.join('\n');
}
