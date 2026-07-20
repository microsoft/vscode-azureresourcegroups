/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ext } from "../../../../extensionVariables";
import { type CopilotChatSessions } from "./copilotSessionLog";
import { analyzePerformance, categorizeTool, type PerformanceAnalysis } from "./diagnosticsMetrics";

/**
 * Local-only diagnostics for the create-project agent workflow.
 *
 * Unlike {@link ../telemetry/workflowTelemetry} (which emits metrics-only,
 * privacy-scoped telemetry), this module keeps a richer, human-readable record
 * — including the originating prompt and per-step timings — **on the user's
 * machine only**. Reports are written as Markdown under `.azure/diagnostics/`
 * and are never transmitted anywhere.
 */

/** Workspace-relative folder where Markdown diagnostics reports are written. */
export const DIAGNOSTICS_DIR = '.azure/diagnostics';

/**
 * Transient runtime folder used to exchange data with the diagnostics hooks
 * (phase context + per-tool-call events). Hidden and pruned; not a report.
 */
export const DIAGNOSTICS_RUNTIME_DIR = '.azure/diagnostics/.runtime';

/** Maximum number of historical report files to retain. */
const MAX_REPORTS = 20;

/** Upper bound on stored/rendered prompt length to keep reports readable. */
const MAX_PROMPT_CHARS = 8_000;

/** Maximum number of individual tool-call rows rendered in a report. */
const MAX_TOOL_ROWS = 50;

/** Maximum number of rows in the "slowest tool calls" section. */
const MAX_SLOWEST_ROWS = 10;

/** Maximum number of rows in the "failed tool calls" section. */
const MAX_FAILED_ROWS = 25;

export type DiagnosticsOutcome = 'completed' | 'abandoned' | 'errored' | 'in-progress';

export interface DiagnosticsPhaseEntry {
    phase: string;
    agent?: string;
    durationMs: number;
    status: 'completed' | 'active' | 'notReached';
}

export interface DiagnosticsToolEntry {
    name: string;
    phase?: string;
    latencyMs: number;
    success: boolean;
    /** Privacy-safe hash of the target path (for churn), never the path itself. */
    targetHash?: string;
}

/** Category 1: run identity + normalization dimensions. */
export interface RunEnvironment {
    extensionVersion?: string;
    vscodeVersion?: string;
    platform?: string;
    autopilot: boolean;
    fileCount?: number;
    linesOfCode?: number;
    dependencyCount?: number;
    languages?: string[];
    hasFrontend?: boolean;
    hasDatabase?: boolean;
    requirementCount?: number;
    plannedRouteCount?: number;
}

/** Category 4: human-in-the-loop friction. */
export interface FrictionStats {
    autopilot: boolean;
    approvalCount: number;
    approvalWaitMs: number;
    activeMs: number;
    revisionCount: number;
    questionsAsked: number;
    safetyTimerFired: boolean;
}

/** Category 2 + 3: tool usage & efficiency. */
export interface ToolStats {
    total: number;
    failures: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    retriedCalls: number;
    terminalFailures: number;
    uniqueFilesTouched: number;
    editChurnRatio: number;
    byCategory: Record<string, number>;
}

/** Category 6: accuracy & quality signals. */
export interface QualitySignals {
    errorDiagnostics?: number;
    warningDiagnostics?: number;
    residualMockMarkers?: number;
    planCompliance?: { expected: number; present: number; score: number; details: string[] };
}

export interface WorkflowDiagnosticsRecord {
    sessionId: string;
    prompt?: string;
    startedAt: number;
    endedAt?: number;
    outcome: DiagnosticsOutcome;
    /** Phase the run stopped on when it did not complete (failed/abandoned). */
    stoppedAtPhase?: string;
    totalDurationMs: number;
    phases: DiagnosticsPhaseEntry[];
    toolCallCount: number;
    toolFailureCount: number;
    tools: DiagnosticsToolEntry[];
    error?: string;
    environment?: RunEnvironment;
    friction?: FrictionStats;
    toolStats?: ToolStats;
    quality?: QualitySignals;
    /**
     * Best-effort links to the VS Code Copilot chat session logs that drove this
     * run (local paths only, never emitted as telemetry). Present when the log
     * directory could be located; its `sessions` list may still be empty.
     */
    copilotChat?: CopilotChatSessions;
}

function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) {
        return 'n/a';
    }
    if (ms < 1_000) {
        return `${Math.round(ms)} ms`;
    }
    const totalSeconds = ms / 1_000;
    if (totalSeconds < 60) {
        return `${totalSeconds.toFixed(1)} s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds - minutes * 60;
    return `${minutes}m ${seconds.toFixed(1)}s`;
}

function formatTimestamp(ms?: number): string {
    if (!ms) {
        return 'n/a';
    }
    return new Date(ms).toLocaleString();
}

function outcomeLabel(outcome: DiagnosticsOutcome): string {
    switch (outcome) {
        case 'completed': return '✅ Completed';
        case 'abandoned': return '⏹️ Abandoned';
        case 'errored': return '❌ Errored';
        case 'in-progress': return '⏳ In progress';
    }
}

function phaseStatusLabel(status: DiagnosticsPhaseEntry['status']): string {
    switch (status) {
        case 'completed': return '✅ completed';
        case 'active': return '▶️ stopped here';
        case 'notReached': return '⬜ not reached';
    }
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Renders a diagnostics record to a self-contained Markdown report. Pure/testable. */
export function renderReportMarkdown(record: WorkflowDiagnosticsRecord): string {
    const lines: string[] = [];
    lines.push(`# Azure Project Create — Diagnostics Report`);
    lines.push('');
    lines.push(`> _Local-only diagnostics. This file stays on your machine and is never sent as telemetry._`);
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('| --- | --- |');
    lines.push(`| Outcome | ${outcomeLabel(record.outcome)} |`);
    lines.push(`| Started | ${formatTimestamp(record.startedAt)} |`);
    lines.push(`| Ended | ${formatTimestamp(record.endedAt)} |`);
    lines.push(`| Total duration | ${formatDuration(record.totalDurationMs)} |`);
    if (record.outcome !== 'completed' && record.stoppedAtPhase) {
        const verb = record.outcome === 'errored' ? 'Failed on' : record.outcome === 'in-progress' ? 'Currently on' : 'Stopped on';
        lines.push(`| ${verb} phase | \`${record.stoppedAtPhase}\` |`);
    }
    lines.push(`| Tool calls | ${record.toolCallCount} (${record.toolFailureCount} failed) |`);
    lines.push(`| Session id | \`${record.sessionId}\` |`);
    lines.push('');

    lines.push(...renderPerformanceAnalysis(record));
    lines.push(...renderEnvironment(record));
    lines.push(...renderCopilotChat(record));
    lines.push(...renderFriction(record));

    // Prompt
    lines.push('## Prompt');
    lines.push('');
    if (record.prompt) {
        const prompt = record.prompt.length > MAX_PROMPT_CHARS
            ? `${record.prompt.slice(0, MAX_PROMPT_CHARS)}\n…(truncated)`
            : record.prompt;
        lines.push('```text');
        lines.push(prompt);
        lines.push('```');
    } else {
        lines.push('_No prompt was captured for this run._');
    }
    lines.push('');

    // Per-phase timings
    lines.push('## Phase timings');
    lines.push('');
    lines.push('| Phase | Status | Agent | Duration |');
    lines.push('| --- | --- | --- | --- |');
    for (const phase of record.phases) {
        lines.push(`| \`${escapeCell(phase.phase)}\` | ${phaseStatusLabel(phase.status)} | ${phase.agent ? `\`${escapeCell(phase.agent)}\`` : '—'} | ${phase.durationMs > 0 || phase.status !== 'notReached' ? formatDuration(phase.durationMs) : '—'} |`);
    }
    lines.push('');

    // Failure / stop detail
    if (record.outcome === 'errored' || record.outcome === 'abandoned') {
        lines.push('## Where it stopped');
        lines.push('');
        const label = record.outcome === 'errored' ? 'failed' : 'was abandoned';
        lines.push(`The run ${label} during the \`${record.stoppedAtPhase ?? 'unknown'}\` phase.`);
        if (record.error) {
            lines.push('');
            lines.push('```text');
            lines.push(record.error);
            lines.push('```');
        }
        lines.push('');
    }

    // Tool calls — grouped per phase so you can see which step each call belongs to.
    lines.push('## Tool calls by phase');
    lines.push('');
    if (record.tools.length === 0) {
        lines.push('_No tool calls were recorded for this run._');
        lines.push('');
        lines.push('> Tip: capturing the agent\'s file/terminal/MCP tool calls requires the diagnostics hooks to be installed. Only the extension\'s own Azure tools are captured without them.');
    } else {
        lines.push(...renderToolCallsByPhase(record));
    }
    lines.push('');

    lines.push(...renderToolEfficiency(record));
    lines.push(...renderFailedToolCalls(record));
    lines.push(...renderSlowestToolCalls(record));
    lines.push(...renderPhaseCategoryBreakdown(record));
    lines.push(...renderQuality(record));

    return lines.join('\n');
}

/** Synthesizes and renders the headline performance assessment for a run. */
function renderPerformanceAnalysis(record: WorkflowDiagnosticsRecord): string[] {
    // Only meaningful once we have the agent's tool calls captured.
    if (record.tools.length === 0) {
        return [];
    }
    const a = analyzePerformance(record);
    const out: string[] = ['## Performance analysis', ''];

    const findings = buildPerformanceFindings(record, a);
    if (findings.length) {
        out.push('### Assessment', '');
        for (const finding of findings) {
            out.push(`- ${finding}`);
        }
        out.push('');
    }

    // Reliability & self-correction.
    out.push('### Reliability & self-correction', '');
    out.push('| Metric | Value |');
    out.push('| --- | --- |');
    out.push(`| Tool success rate | ${a.successRatePct}% (${a.failures}/${a.totalCalls} failed) |`);
    out.push(`| Retried calls | ${a.retriedCalls} |`);
    out.push(`| Longest failure streak | ${a.longestFailureStreak} |`);
    out.push(`| Files re-edited | ${a.reeditedFileCount}${a.maxReeditsOnOneFile > 1 ? ` (up to ${a.maxReeditsOnOneFile}× on one file)` : ''} |`);
    out.push(`| Rework ratio (repeat edits) | ${a.reworkRatioPct}% |`);
    out.push(`| Human revision round-trips | ${a.revisionRoundTrips} |`);
    out.push('');

    // Top issue sources.
    if (a.topFailingTools.length || a.failuresByPhase.length || a.failuresByCategory.length) {
        out.push('### Top issue sources', '');
        if (a.topFailingTools.length) {
            out.push('| Tool | Failures | Attempts | Failure rate |');
            out.push('| --- | --- | --- | --- |');
            for (const tool of a.topFailingTools) {
                const rate = tool.attempts > 0 ? Math.round((tool.failures / tool.attempts) * 100) : 0;
                out.push(`| \`${escapeCell(tool.name)}\` | ${tool.failures} | ${tool.attempts} | ${rate}% |`);
            }
            out.push('');
        }
        if (a.failuresByPhase.length) {
            out.push(`- Failures by phase: ${a.failuresByPhase.map((p) => `\`${escapeCell(p.key)}\` ${p.failures}/${p.calls}`).join(', ')}`);
        }
        if (a.failuresByCategory.length) {
            out.push(`- Failures by category: ${a.failuresByCategory.map((c) => `${escapeCell(c.key)} ${c.failures}/${c.calls}`).join(', ')}`);
        }
        out.push('');
    }

    // Bottlenecks.
    const bottleneckRows: string[] = [];
    if (a.slowestPhaseByDuration) {
        bottleneckRows.push(`| Slowest phase (wall-clock) | \`${escapeCell(a.slowestPhaseByDuration.phase)}\` | ${formatDuration(a.slowestPhaseByDuration.durationMs)} |`);
    }
    if (a.slowestPhaseByToolTime && a.slowestPhaseByToolTime.toolMs > 0) {
        bottleneckRows.push(`| Most tool time | \`${escapeCell(a.slowestPhaseByToolTime.phase)}\` | ${formatDuration(a.slowestPhaseByToolTime.toolMs)} |`);
    }
    if (a.busiestPhaseByCalls) {
        bottleneckRows.push(`| Most tool calls | \`${escapeCell(a.busiestPhaseByCalls.phase)}\` | ${a.busiestPhaseByCalls.calls} call(s) |`);
    }
    if (a.longestCall) {
        bottleneckRows.push(`| Longest single call | \`${escapeCell(a.longestCall.name)}\` (\`${escapeCell(a.longestCall.phase)}\`) | ${formatDuration(a.longestCall.latencyMs)} |`);
    }
    if (a.approvalWaitMs > 0) {
        bottleneckRows.push(`| Waiting on approvals | human-in-the-loop | ${formatDuration(a.approvalWaitMs)} |`);
    }
    const categoryTime = Object.entries(a.categoryTimeMs).sort((x, y) => y[1] - x[1]);
    if (categoryTime.length) {
        bottleneckRows.push(`| Tool time by category | — | ${escapeCell(categoryTime.map(([c, ms]) => `${c} ${formatDuration(ms)}`).join(', '))} |`);
    }
    if (bottleneckRows.length) {
        out.push('### Bottlenecks', '');
        out.push('| Bottleneck | Where | Cost |');
        out.push('| --- | --- | --- |');
        out.push(...bottleneckRows);
        out.push('');
    }

    return out;
}

/** Turns the numeric {@link PerformanceAnalysis} into a short, human-readable assessment. */
function buildPerformanceFindings(record: WorkflowDiagnosticsRecord, a: PerformanceAnalysis): string[] {
    const findings: string[] = [];

    // Headline reliability.
    if (a.failures === 0 && a.retriedCalls === 0 && a.reeditedFileCount === 0) {
        findings.push(`Clean first-pass run: ${a.totalCalls} tool call(s) with no failures, retries, or rework.`);
    } else {
        findings.push(`${a.successRatePct}% tool success (${a.failures}/${a.totalCalls} call(s) failed).`);
    }

    // Self-correction / rework.
    if (a.retriedCalls > 0 || a.reeditedFileCount > 0) {
        const parts: string[] = [];
        if (a.retriedCalls > 0) {
            parts.push(`${a.retriedCalls} retried call(s)`);
        }
        if (a.reeditedFileCount > 0) {
            parts.push(`${a.reeditedFileCount} file(s) re-edited${a.maxReeditsOnOneFile > 1 ? ` (up to ${a.maxReeditsOnOneFile}× on one file)` : ''}`);
        }
        findings.push(`Agent self-corrected: ${parts.join(', ')} — rework ratio ${a.reworkRatioPct}%.`);
    }
    if (a.revisionRoundTrips > 0) {
        findings.push(`${a.revisionRoundTrips} human revision round-trip(s) were requested.`);
    }
    if (a.longestFailureStreak > 1) {
        findings.push(`Longest failure streak: ${a.longestFailureStreak} consecutive failed call(s).`);
    }

    // Biggest issue source.
    if (a.topFailingTools.length > 0) {
        const top = a.topFailingTools[0];
        const wherePhase = a.failuresByPhase[0] ? `, mostly in the \`${a.failuresByPhase[0].key}\` phase` : '';
        findings.push(`Biggest issue source: \`${top.name}\` (${top.failures} failure(s) across ${top.attempts} call(s))${wherePhase}.`);
    }

    // Bottlenecks.
    const bottleneckBits: string[] = [];
    if (a.slowestPhaseByDuration) {
        bottleneckBits.push(`slowest phase \`${a.slowestPhaseByDuration.phase}\` (${formatDuration(a.slowestPhaseByDuration.durationMs)})`);
    }
    if (a.slowestPhaseByToolTime && a.slowestPhaseByToolTime.toolMs > 0 &&
        (!a.slowestPhaseByDuration || a.slowestPhaseByToolTime.phase !== a.slowestPhaseByDuration.phase)) {
        bottleneckBits.push(`most tool time in \`${a.slowestPhaseByToolTime.phase}\` (${formatDuration(a.slowestPhaseByToolTime.toolMs)})`);
    }
    if (a.longestCall && a.longestCall.latencyMs >= 1_000) {
        bottleneckBits.push(`longest single call \`${a.longestCall.name}\` (${formatDuration(a.longestCall.latencyMs)})`);
    }
    if (bottleneckBits.length) {
        findings.push(`Bottlenecks: ${bottleneckBits.join('; ')}.`);
    }

    // Approval friction.
    const handsOnMs = a.activeMs + a.approvalWaitMs;
    if (a.approvalWaitMs > 0 && handsOnMs > 0) {
        const pct = Math.round((a.approvalWaitMs / handsOnMs) * 100);
        if (pct >= 20) {
            findings.push(`${pct}% of hands-on time was spent waiting on manual approvals.`);
        }
    }

    // Residual quality issues.
    const errors = record.quality?.errorDiagnostics;
    if (typeof errors === 'number' && errors > 0) {
        findings.push(`${errors} error diagnostic(s) still present at report time.`);
    }

    return findings;
}

/** Category 1 — run identity & normalization. */
function renderEnvironment(record: WorkflowDiagnosticsRecord): string[] {
    const env = record.environment;
    if (!env) {
        return [];
    }
    const out: string[] = ['## Run environment', ''];
    out.push('| Field | Value |');
    out.push('| --- | --- |');
    out.push(`| Mode | ${env.autopilot ? 'Autopilot' : 'Guided'} |`);
    if (env.languages?.length) { out.push(`| Languages | ${env.languages.map((l) => escapeCell(l)).join(', ')} |`); }
    out.push(`| Has frontend | ${env.hasFrontend ? 'yes' : 'no'} |`);
    out.push(`| Has database | ${env.hasDatabase ? 'yes' : 'no'} |`);
    if (env.fileCount !== undefined) { out.push(`| Source files | ${env.fileCount} |`); }
    if (env.linesOfCode !== undefined) { out.push(`| Lines of code | ${env.linesOfCode} |`); }
    if (env.dependencyCount !== undefined) { out.push(`| Dependencies | ${env.dependencyCount} |`); }
    if (env.requirementCount !== undefined) { out.push(`| Requirements answered | ${env.requirementCount} |`); }
    if (env.plannedRouteCount !== undefined) { out.push(`| Planned routes (approx) | ${env.plannedRouteCount} |`); }
    if (env.extensionVersion) { out.push(`| Extension version | ${escapeCell(env.extensionVersion)} |`); }
    if (env.vscodeVersion) { out.push(`| VS Code version | ${escapeCell(env.vscodeVersion)} |`); }
    if (env.platform) { out.push(`| Platform | ${escapeCell(env.platform)} |`); }
    out.push('');
    return out;
}

/**
 * Links the report back to the VS Code Copilot chat session logs that drove the
 * run. These logs are owned by the Copilot Chat extension — we only point at
 * them so a run is traceable to its conversation. Rendered only when the log
 * directory was located; paths are local and never transmitted.
 */
function renderCopilotChat(record: WorkflowDiagnosticsRecord): string[] {
    const chat = record.copilotChat;
    if (!chat) {
        return [];
    }
    const out: string[] = ['## Copilot chat session logs', ''];
    out.push('> _These logs are written by VS Code Copilot Chat, not this extension. This report only links to them; the paths are local and never sent as telemetry._');
    out.push('');
    if (chat.sessions.length === 0) {
        out.push(vscode.l10n.t('No chat session logs matched this run\'s time window. Look under:'));
        out.push('');
        out.push(`\`${chat.debugLogsDir.fsPath}\``);
        out.push('');
        return out;
    }
    out.push(vscode.l10n.t('Session logs active during this run (newest first):'));
    out.push('');
    for (const uri of chat.sessions) {
        const name = uri.path.split('/').pop() ?? uri.path;
        out.push(`- [${escapeCell(name)}](${uri.toString()})`);
    }
    out.push('');
    out.push(`_${vscode.l10n.t('Directory')}: \`${chat.debugLogsDir.fsPath}\`_`);
    out.push('');
    return out;
}

/** Category 4 — human-in-the-loop friction. */
function renderFriction(record: WorkflowDiagnosticsRecord): string[] {
    const f = record.friction;
    if (!f) {
        return [];
    }
    const out: string[] = ['## Human-in-the-loop', ''];
    out.push('| Field | Value |');
    out.push('| --- | --- |');
    out.push(`| Active (agent) time | ${formatDuration(f.activeMs)} |`);
    out.push(`| Waiting on approval | ${formatDuration(f.approvalWaitMs)} |`);
    out.push(`| Manual approvals | ${f.approvalCount} |`);
    out.push(`| Revision round-trips | ${f.revisionCount} |`);
    out.push(`| Clarifying questions asked | ${f.questionsAsked} |`);
    if (f.safetyTimerFired) { out.push(`| Safety timeout fired | yes |`); }
    out.push('');
    return out;
}

/** Categories 2 & 3 — tool efficiency. */
function renderToolEfficiency(record: WorkflowDiagnosticsRecord): string[] {
    const s = record.toolStats;
    if (!s || s.total === 0) {
        return [];
    }
    const out: string[] = ['## Tool efficiency', ''];
    out.push('| Metric | Value |');
    out.push('| --- | --- |');
    out.push(`| Total tool calls | ${s.total} (${s.failures} failed) |`);
    out.push(`| Latency p50 / p95 | ${formatDuration(s.p50LatencyMs)} / ${formatDuration(s.p95LatencyMs)} |`);
    out.push(`| Retried calls | ${s.retriedCalls} |`);
    out.push(`| Terminal failures | ${s.terminalFailures} |`);
    if (s.uniqueFilesTouched > 0) {
        out.push(`| Unique files edited | ${s.uniqueFilesTouched} |`);
        out.push(`| Edit churn (edits/file) | ${s.editChurnRatio} |`);
    }
    const mix = Object.entries(s.byCategory).map(([k, v]) => `${k}: ${v}`).join(', ');
    if (mix) { out.push(`| Call mix | ${escapeCell(mix)} |`); }
    out.push('');
    return out;
}

/** Lists every failed tool call so failures are visible without scanning per-phase tables. */
function renderFailedToolCalls(record: WorkflowDiagnosticsRecord): string[] {
    const failures = record.tools.filter((t) => !t.success);
    if (failures.length === 0) {
        return [];
    }
    const out: string[] = ['## Failed tool calls', ''];
    const shown = failures.slice(0, MAX_FAILED_ROWS);
    const hidden = failures.length - shown.length;
    out.push('| Tool | Phase | Category | Latency |');
    out.push('| --- | --- | --- | --- |');
    for (const tool of shown) {
        out.push(`| \`${escapeCell(tool.name)}\` | \`${escapeCell(tool.phase ?? 'unknown')}\` | ${categorizeTool(tool.name)} | ${formatDuration(tool.latencyMs)} |`);
    }
    out.push('');
    if (hidden > 0) {
        out.push(`_…and ${hidden} more failed call(s) not shown._`);
        out.push('');
    }
    return out;
}

/** Highlights the slowest tool calls across the whole run, so latency hot spots stand out. */
function renderSlowestToolCalls(record: WorkflowDiagnosticsRecord): string[] {
    const withLatency = record.tools.filter((t) => Number.isFinite(t.latencyMs) && t.latencyMs >= 0);
    if (withLatency.length === 0) {
        return [];
    }
    const slowest = [...withLatency].sort((a, b) => b.latencyMs - a.latencyMs).slice(0, MAX_SLOWEST_ROWS);
    const out: string[] = ['## Slowest tool calls', ''];
    out.push('| Tool | Phase | Category | Latency | Result |');
    out.push('| --- | --- | --- | --- | --- |');
    for (const tool of slowest) {
        out.push(`| \`${escapeCell(tool.name)}\` | \`${escapeCell(tool.phase ?? 'unknown')}\` | ${categorizeTool(tool.name)} | ${formatDuration(tool.latencyMs)} | ${tool.success ? '✅' : '❌'} |`);
    }
    out.push('');
    return out;
}

/** Breaks each phase's tool calls down by category (read/edit/terminal/mcp/…) to show where effort went. */
function renderPhaseCategoryBreakdown(record: WorkflowDiagnosticsRecord): string[] {
    if (record.tools.length === 0) {
        return [];
    }

    // phase -> category -> count
    const byPhase = new Map<string, Record<string, number>>();
    const categoriesSeen = new Set<string>();
    for (const tool of record.tools) {
        const phase = tool.phase ?? 'unknown';
        const category = categorizeTool(tool.name);
        categoriesSeen.add(category);
        const counts = byPhase.get(phase) ?? {};
        counts[category] = (counts[category] ?? 0) + 1;
        byPhase.set(phase, counts);
    }

    // Order phases as they appear in the workflow, then any leftovers.
    const orderedPhases = record.phases.map((p) => p.phase);
    const phaseOrder = [...orderedPhases, ...[...byPhase.keys()].filter((p) => !orderedPhases.includes(p))]
        .filter((p, i, arr) => arr.indexOf(p) === i && byPhase.has(p));

    // Stable column order for categories.
    const categoryOrder = ['read', 'edit', 'terminal', 'mcp', 'question', 'other'].filter((c) => categoriesSeen.has(c));
    if (categoryOrder.length === 0 || phaseOrder.length === 0) {
        return [];
    }

    const out: string[] = ['## Tool categories by phase', ''];
    out.push(`| Phase | ${categoryOrder.join(' | ')} | Total |`);
    out.push(`| --- | ${categoryOrder.map(() => '---').join(' | ')} | --- |`);
    for (const phase of phaseOrder) {
        const counts = byPhase.get(phase) ?? {};
        const cells = categoryOrder.map((c) => String(counts[c] ?? 0));
        const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
        out.push(`| \`${escapeCell(phase)}\` | ${cells.join(' | ')} | ${total} |`);
    }
    out.push('');
    return out;
}

/** Category 6 — accuracy & quality. */
function renderQuality(record: WorkflowDiagnosticsRecord): string[] {
    const q = record.quality;
    if (!q) {
        return [];
    }
    const out: string[] = ['## Quality signals', ''];
    out.push('| Signal | Value |');
    out.push('| --- | --- |');
    if (q.errorDiagnostics !== undefined) { out.push(`| Errors (diagnostics) | ${q.errorDiagnostics} |`); }
    if (q.warningDiagnostics !== undefined) { out.push(`| Warnings (diagnostics) | ${q.warningDiagnostics} |`); }
    if (q.residualMockMarkers !== undefined) { out.push(`| Residual mock markers | ${q.residualMockMarkers} |`); }
    if (q.planCompliance) {
        out.push(`| Plan compliance | ${q.planCompliance.present}/${q.planCompliance.expected} (${Math.round(q.planCompliance.score * 100)}%) |`);
    }
    out.push('');
    if (q.planCompliance?.details.length) {
        for (const d of q.planCompliance.details) {
            out.push(`- ${escapeCell(d)}`);
        }
        out.push('');
    }
    out.push('> Diagnostics counts reflect files analyzed by language servers at report time and may be partial.');
    out.push('');
    return out;
}

/** Groups the run's tool calls under each phase, in phase order, with per-phase totals. */
function renderToolCallsByPhase(record: WorkflowDiagnosticsRecord): string[] {
    const out: string[] = [];

    // Bucket tools by phase; preserve encounter order within each phase.
    const byPhase = new Map<string, DiagnosticsToolEntry[]>();
    for (const tool of record.tools) {
        const key = tool.phase ?? 'unknown';
        const list = byPhase.get(key) ?? [];
        list.push(tool);
        byPhase.set(key, list);
    }

    // Emit phases in workflow order (as they appear in record.phases), then any
    // leftover buckets (e.g. 'unknown') not represented there.
    const orderedPhases = record.phases.map((p) => p.phase);
    const seen = new Set<string>();
    const phaseOrder = [...orderedPhases, ...[...byPhase.keys()].filter((p) => !orderedPhases.includes(p))];

    for (const phase of phaseOrder) {
        if (seen.has(phase)) {
            continue;
        }
        seen.add(phase);
        const tools = byPhase.get(phase);
        if (!tools || tools.length === 0) {
            continue;
        }
        const failures = tools.filter((t) => !t.success).length;
        const totalMs = tools.reduce((sum, t) => sum + (Number.isFinite(t.latencyMs) ? t.latencyMs : 0), 0);
        out.push(`### \`${escapeCell(phase)}\` — ${tools.length} call(s), ${failures} failed, ${formatDuration(totalMs)} total`);
        out.push('');
        const shown = tools.slice(-MAX_TOOL_ROWS);
        const hidden = tools.length - shown.length;
        out.push('| Tool | Latency | Result |');
        out.push('| --- | --- | --- |');
        for (const tool of shown) {
            out.push(`| \`${escapeCell(tool.name)}\` | ${formatDuration(tool.latencyMs)} | ${tool.success ? '✅' : '❌'} |`);
        }
        if (hidden > 0) {
            out.push('');
            out.push(`_…and ${hidden} earlier call(s) in this phase not shown._`);
        }
        out.push('');
    }

    return out;
}

function getDiagnosticsFolder(): vscode.Uri | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        return undefined;
    }
    return vscode.Uri.joinPath(folder.uri, ...DIAGNOSTICS_DIR.split('/'));
}

function reportFileName(record: WorkflowDiagnosticsRecord): string {
    const ts = new Date(record.endedAt ?? record.startedAt ?? Date.now()).toISOString().replace(/[:.]/g, '-');
    const shortId = record.sessionId.slice(0, 8);
    return `${ts}-${shortId}.md`;
}

async function pruneOldReports(folder: vscode.Uri): Promise<void> {
    let entries: [string, vscode.FileType][];
    try {
        entries = await vscode.workspace.fs.readDirectory(folder);
    } catch {
        return;
    }
    const reports = entries
        .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.md'))
        .map(([name]) => name)
        .sort(); // ISO-timestamp prefix sorts chronologically
    const excess = reports.length - MAX_REPORTS;
    for (let i = 0; i < excess; i++) {
        try {
            await vscode.workspace.fs.delete(vscode.Uri.joinPath(folder, reports[i]));
            // Remove the machine-readable sidecar too.
            await vscode.workspace.fs.delete(vscode.Uri.joinPath(folder, reports[i].replace(/\.md$/, '.json')));
        } catch {
            // Best effort.
        }
    }
}

/**
 * Writes the diagnostics report to `.azure/diagnostics/` and prunes old reports.
 * Returns the file URI, or `undefined` when there's no workspace to write to.
 */
export async function writeDiagnosticsReport(record: WorkflowDiagnosticsRecord): Promise<vscode.Uri | undefined> {
    const folder = getDiagnosticsFolder();
    if (!folder) {
        return undefined;
    }
    try {
        await vscode.workspace.fs.createDirectory(folder);
        const target = vscode.Uri.joinPath(folder, reportFileName(record));
        await vscode.workspace.fs.writeFile(target, Buffer.from(renderReportMarkdown(record), 'utf-8'));
        // Machine-readable sidecar for cross-run comparison / benchmarking.
        const jsonTarget = vscode.Uri.joinPath(folder, reportFileName(record).replace(/\.md$/, '.json'));
        await vscode.workspace.fs.writeFile(jsonTarget, Buffer.from(JSON.stringify(record, null, 2), 'utf-8'));
        await pruneOldReports(folder);
        ext.outputChannel.appendLog(`[ProjectDiagnostics] Wrote diagnostics report: ${vscode.workspace.asRelativePath(target)}`);
        return target;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ext.outputChannel.appendLog(`[ProjectDiagnostics] Failed to write diagnostics report: ${message}`);
        return undefined;
    }
}

/** Lists existing report files, newest first. */
export async function listReportFiles(): Promise<vscode.Uri[]> {
    const folder = getDiagnosticsFolder();
    if (!folder) {
        return [];
    }
    let entries: [string, vscode.FileType][];
    try {
        entries = await vscode.workspace.fs.readDirectory(folder);
    } catch {
        return [];
    }
    return entries
        .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.md'))
        .map(([name]) => name)
        .sort()
        .reverse()
        .map((name) => vscode.Uri.joinPath(folder, name));
}

/** Opens a rendered report (from ad-hoc content) in a Markdown preview. */
export async function openReportContent(content: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.commands.executeCommand('markdown.showPreviewToSide', doc.uri);
}

/** Opens an existing report file in a Markdown preview. */
export async function openReportFile(uri: vscode.Uri): Promise<void> {
    await vscode.window.showTextDocument(uri, { preview: false });
    await vscode.commands.executeCommand('markdown.showPreviewToSide', uri);
}

// #region Hook interop (phase context + agent tool-call events)

function getRuntimeFolder(): vscode.Uri | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        return undefined;
    }
    return vscode.Uri.joinPath(folder.uri, ...DIAGNOSTICS_RUNTIME_DIR.split('/'));
}

/**
 * Absolute path to the pointer file the diagnostics hooks read. It lives next to
 * the installed hook scripts (`~/.agents/hooks`) — the same directory the hooks
 * run from — so a hook (which doesn't know the workspace root) can locate the
 * per-run runtime folder and current phase. Returns `undefined` when the hooks
 * directory isn't present.
 */
async function getHookPointerUri(): Promise<vscode.Uri | undefined> {
    const hooksDir = vscode.Uri.file(path.join(os.homedir(), '.agents', 'hooks'));
    try {
        const stat = await vscode.workspace.fs.stat(hooksDir);
        if (stat.type !== vscode.FileType.Directory) {
            return undefined;
        }
    } catch {
        return undefined; // Hooks not installed → capture inactive.
    }
    return vscode.Uri.joinPath(hooksDir, '.diagnostics-context.json');
}

/**
 * Writes the active phase context so the diagnostics hooks (a separate process)
 * can tag each agent tool call with the current session and phase, and know
 * where to append events. Best effort; no-op when hooks aren't installed.
 */
export async function writePhaseContext(sessionId: string, phase: string): Promise<void> {
    const runtime = getRuntimeFolder();
    const pointer = await getHookPointerUri();
    if (!runtime || !pointer) {
        return;
    }
    try {
        await vscode.workspace.fs.createDirectory(runtime);
        const payload = JSON.stringify({ sessionId, phase, runtimeDir: runtime.fsPath, updatedAt: Date.now() });
        await vscode.workspace.fs.writeFile(pointer, Buffer.from(payload, 'utf-8'));
    } catch {
        // Best effort — capture simply won't be phase-tagged if this fails.
    }
}

/** Removes the hook pointer file. Best effort. */
export async function clearPhaseContext(): Promise<void> {
    const pointer = await getHookPointerUri();
    if (!pointer) {
        return;
    }
    try {
        await vscode.workspace.fs.delete(pointer);
    } catch {
        // Already gone.
    }
}

/**
 * Reads the agent tool-call events recorded by the diagnostics hooks for a
 * session, if present. Each line is a JSON object
 * `{ tool, phase, latencyMs, success }`. Never contains tool arguments or
 * output — only metadata. Returns an empty array when no hook log exists.
 */
export async function readHookToolEvents(sessionId: string): Promise<DiagnosticsToolEntry[]> {
    const folder = getRuntimeFolder();
    if (!folder) {
        return [];
    }
    const target = vscode.Uri.joinPath(folder, `tool-events-${sessionId}.jsonl`);
    let raw: string;
    try {
        raw = Buffer.from(await vscode.workspace.fs.readFile(target)).toString('utf-8');
    } catch {
        return [];
    }
    const events: DiagnosticsToolEntry[] = [];
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        try {
            const parsed = JSON.parse(trimmed) as Partial<DiagnosticsToolEntry>;
            if (typeof parsed.name === 'string' && typeof parsed.latencyMs === 'number') {
                events.push({
                    name: parsed.name,
                    phase: typeof parsed.phase === 'string' ? parsed.phase : undefined,
                    latencyMs: parsed.latencyMs,
                    success: parsed.success !== false,
                    targetHash: typeof parsed.targetHash === 'string' && parsed.targetHash ? parsed.targetHash : undefined,
                });
            }
        } catch {
            // Skip malformed lines.
        }
    }
    return events;
}

/** Removes the per-session hook event log and phase context. Best effort. */
export async function cleanupHookRuntime(sessionId: string): Promise<void> {
    const folder = getRuntimeFolder();
    if (!folder) {
        return;
    }
    try {
        await vscode.workspace.fs.delete(vscode.Uri.joinPath(folder, `tool-events-${sessionId}.jsonl`));
    } catch {
        // Already gone.
    }
    await clearPhaseContext();
}

// #endregion
