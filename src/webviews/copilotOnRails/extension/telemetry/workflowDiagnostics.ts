/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ext } from "../../../../extensionVariables";

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

    lines.push(...renderEnvironment(record));
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
    lines.push(...renderQuality(record));

    return lines.join('\n');
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
