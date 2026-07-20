/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { ext } from "../../../../extensionVariables";
import { DEBUG_PLAN_FILE_GLOB } from "../../../../tree/project/projectPlanFiles";
import { isDebugPlanImplemented } from "../autopilot";
import { type DiagnosticsOutcome, type DiagnosticsToolEntry, type WorkflowDiagnosticsRecord, cleanupHookRuntime, readHookToolEvents, writeDiagnosticsReport, writePhaseContext } from "./workflowDiagnostics";
import { collectRunSignals } from "./collectRunSignals";
import { collectCopilotChatSessions } from "./copilotSessionLog";
import { computeToolStats } from "./diagnosticsMetrics";

/**
 * Wall-clock instrumentation for the create-project agent workflow.
 *
 * A single "session" spans the ordered phases requirements → plan → scaffold →
 * integrate → debug → deploy. Each phase is driven by a different chat agent and
 * may cross window reloads, so the session record is persisted in
 * `workspaceState`. On each phase transition we emit a per-phase span and, when
 * the run ends, a session-summary event carrying the outcome and per-phase
 * durations.
 *
 * Privacy: only enumerated phase/agent/outcome names, numeric durations/counts,
 * and a random correlation GUID are emitted — never prompt text, file paths, or
 * file contents. Everything flows through {@link callWithTelemetryAndErrorHandling},
 * which already respects the user's VS Code telemetry setting.
 */

export const WORKFLOW_PHASES = ['requirements', 'plan', 'scaffold', 'integrate', 'debug', 'deploy'] as const;
export type WorkflowPhase = typeof WORKFLOW_PHASES[number];

export type WorkflowOutcome = 'completed' | 'abandoned' | 'errored';

/** Telemetry event names. */
const PHASE_EVENT = 'azureResourceGroups.workflow.phase';
const SESSION_EVENT = 'azureResourceGroups.workflow.session';

/** workspaceState key holding the in-progress session record. */
const STATE_SESSION = 'azureResourceGroups.workflow.session';

/** Glob for the deployment plan whose terminal status ends the workflow. */
const DEPLOY_PLAN_GLOB = '.azure/deployment-plan.md';

/**
 * Maximum wall-clock duration a session may stay open. If a window closes
 * mid-run and never reopens (or a run stalls) the next activation past this
 * deadline records the session as abandoned instead of leaking forever.
 */
const MAX_RUN_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * The only property keys this module ever emits. Kept as an allowlist so a unit
 * test can assert we never leak prompt/file/secret content into telemetry.
 */
export const ALLOWED_WORKFLOW_PROPERTY_KEYS = ['phase', 'agent', 'outcome', 'abandonedPhase', 'lastPhase', 'sessionId', 'autopilot'] as const;

/** Upper bound on locally-stored prompt length. */
const MAX_PROMPT_CHARS = 8_000;

/** Upper bound on retained per-run tool-call detail entries. */
const MAX_TOOL_ENTRIES = 200;

interface WorkflowSessionRecord {
    /** Random GUID used only to correlate this run's events; not derived from any content. */
    sessionId: string;
    startedAt: number;
    currentPhase: WorkflowPhase;
    phaseStartedAt: number;
    phaseDurationsMs: Partial<Record<WorkflowPhase, number>>;
    toolCallCount: number;
    toolFailureCount: number;
    lastAgent?: string;
    /** Epoch ms after which the session is considered stale/abandoned. */
    deadline: number;
    /**
     * Local-only diagnostics detail (never emitted as telemetry): the originating
     * prompt, the agent that drove each phase, and per-tool-call detail.
     */
    prompt?: string;
    phaseAgents: Partial<Record<WorkflowPhase, string>>;
    tools: DiagnosticsToolEntry[];
    /** Category 4 (friction) counters, all local-only. */
    autopilot: boolean;
    approvalCount: number;
    approvalWaitMs: number;
    revisionCount: number;
    safetyTimerFired: boolean;
    /** Epoch ms when an approval gate opened; used to accumulate wait time. */
    approvalPendingAt?: number;
}

let completionWatchers: vscode.Disposable[] = [];
let safetyTimer: ReturnType<typeof setTimeout> | undefined;

function readSession(): WorkflowSessionRecord | undefined {
    return ext.context.workspaceState.get<WorkflowSessionRecord>(STATE_SESSION);
}

async function writeSession(record: WorkflowSessionRecord | undefined): Promise<void> {
    await ext.context.workspaceState.update(STATE_SESSION, record);
}

function newSessionId(): string {
    const globalCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (globalCrypto?.randomUUID) {
        return globalCrypto.randomUUID();
    }
    // Fallback GUID (v4-shaped) for hosts without a global crypto.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/** Maps a chat agent mode to the workflow phase it drives. */
export function phaseForAgent(agentMode: string): WorkflowPhase | undefined {
    switch (agentMode) {
        case 'azure-project-scaffold': return 'scaffold';
        case 'azure-project-integrate': return 'integrate';
        case 'azure-debug-plan':
        case 'azure-debug-generate': return 'debug';
        case 'azure-deploy': return 'deploy';
        default: return undefined;
    }
}

/**
 * Pure builder for a per-phase span event. Exported for unit/privacy testing.
 * @param endedPhase The phase that just finished.
 * @param durationMs How long that phase took.
 */
export function buildPhaseTelemetry(record: WorkflowSessionRecord, endedPhase: WorkflowPhase, durationMs: number): { properties: Record<string, string>; measurements: Record<string, number> } {
    return {
        properties: {
            phase: endedPhase,
            sessionId: record.sessionId,
            ...(record.lastAgent ? { agent: record.lastAgent } : {}),
        },
        measurements: {
            phaseDurationMs: durationMs,
        },
    };
}

/** Pure builder for the session-summary event. Exported for unit/privacy testing. */
export function buildSessionTelemetry(record: WorkflowSessionRecord, outcome: WorkflowOutcome, endedAt: number): { properties: Record<string, string>; measurements: Record<string, number> } {
    const measurements: Record<string, number> = {
        durationMs: Math.max(0, endedAt - record.startedAt),
        toolCallCount: record.toolCallCount,
        toolFailureCount: record.toolFailureCount,
    };
    for (const phase of WORKFLOW_PHASES) {
        const ms = record.phaseDurationsMs[phase];
        if (typeof ms === 'number') {
            measurements[`${phase}Ms`] = ms;
        }
    }
    // Category 4 (friction) aggregates — numbers only.
    if (typeof record.approvalCount === 'number') { measurements.approvalCount = record.approvalCount; }
    if (typeof record.approvalWaitMs === 'number') { measurements.approvalWaitMs = record.approvalWaitMs; }
    if (typeof record.revisionCount === 'number') { measurements.revisionCount = record.revisionCount; }
    const properties: Record<string, string> = {
        outcome,
        lastPhase: record.currentPhase,
        sessionId: record.sessionId,
        ...(record.autopilot ? { autopilot: 'true' } : {}),
        ...(record.lastAgent ? { agent: record.lastAgent } : {}),
    };
    if (outcome === 'abandoned') {
        properties.abandonedPhase = record.currentPhase;
    }
    return { properties, measurements };
}

function applyTelemetry(context: IActionContext, data: { properties: Record<string, string>; measurements: Record<string, number> }): void {
    context.errorHandling.suppressDisplay = true;
    context.errorHandling.suppressReportIssue = true;
    Object.assign(context.telemetry.properties, data.properties);
    Object.assign(context.telemetry.measurements, data.measurements);
}

async function emitPhaseSpan(record: WorkflowSessionRecord, endedPhase: WorkflowPhase, durationMs: number): Promise<void> {
    await callWithTelemetryAndErrorHandling(PHASE_EVENT, async (context: IActionContext) => {
        applyTelemetry(context, buildPhaseTelemetry(record, endedPhase, durationMs));
    });
}

async function emitSessionSummary(record: WorkflowSessionRecord, outcome: WorkflowOutcome, endedAt: number): Promise<void> {
    await callWithTelemetryAndErrorHandling(SESSION_EVENT, async (context: IActionContext) => {
        applyTelemetry(context, buildSessionTelemetry(record, outcome, endedAt));
    });
}

/**
 * Records that the workflow has entered `phase`. Starts a session on first use,
 * finalizes the previous phase's duration (emitting a span), and is a no-op when
 * the phase is already active so overlapping controller + command hand-offs
 * aren't double-counted.
 */
export async function beginPhase(phase: WorkflowPhase, agentMode?: string, prompt?: string): Promise<void> {
    const now = Date.now();
    let record = readSession();

    // A stale session from a prior, never-completed run: close it out as
    // abandoned before starting the new one so timings don't bleed together.
    if (record && now > record.deadline) {
        await finalizeAndClear('abandoned', now, record);
        record = undefined;
    }

    if (!record) {
        record = {
            sessionId: newSessionId(),
            startedAt: now,
            currentPhase: phase,
            phaseStartedAt: now,
            phaseDurationsMs: {},
            toolCallCount: 0,
            toolFailureCount: 0,
            lastAgent: agentMode,
            deadline: now + MAX_RUN_DURATION_MS,
            prompt: truncatePrompt(prompt),
            phaseAgents: agentMode ? { [phase]: agentMode } : {},
            tools: [],
            autopilot: false,
            approvalCount: 0,
            approvalWaitMs: 0,
            revisionCount: 0,
            safetyTimerFired: false,
        };
        await writeSession(record);
        armSafetyTimer(record.deadline);
        registerCompletionWatchers();
        void writePhaseContext(record.sessionId, phase);
        return;
    }

    // First non-empty prompt seen wins (the user's original request).
    if (!record.prompt && prompt) {
        record.prompt = truncatePrompt(prompt);
    }

    // Re-entry into the same phase (e.g. controller + command both fire, or a
    // feedback/revision round-trip): just refresh the agent tag and deadline.
    if (record.currentPhase === phase) {
        record.lastAgent = agentMode ?? record.lastAgent;
        if (agentMode) { record.phaseAgents[phase] = agentMode; }
        record.deadline = now + MAX_RUN_DURATION_MS;
        await writeSession(record);
        armSafetyTimer(record.deadline);
        void writePhaseContext(record.sessionId, phase);
        return;
    }

    // Transition: finalize the outgoing phase and emit its span.
    const priorDuration = Math.max(0, now - record.phaseStartedAt);
    record.phaseDurationsMs[record.currentPhase] = (record.phaseDurationsMs[record.currentPhase] ?? 0) + priorDuration;
    await emitPhaseSpan(record, record.currentPhase, priorDuration);

    record.currentPhase = phase;
    record.phaseStartedAt = now;
    record.lastAgent = agentMode ?? record.lastAgent;
    if (agentMode) { record.phaseAgents[phase] = agentMode; }
    record.deadline = now + MAX_RUN_DURATION_MS;
    await writeSession(record);
    armSafetyTimer(record.deadline);
    registerCompletionWatchers();
    void writePhaseContext(record.sessionId, phase);
}

function truncatePrompt(prompt: string | undefined): string | undefined {
    if (!prompt) {
        return undefined;
    }
    const trimmed = prompt.trim();
    if (!trimmed) {
        return undefined;
    }
    return trimmed.length > MAX_PROMPT_CHARS ? trimmed.slice(0, MAX_PROMPT_CHARS) : trimmed;
}

/** Increments the per-session tool-call counters used in the summary event. */
export async function recordToolCall(event: { name: string; latencyMs: number; success: boolean }): Promise<void> {
    const record = readSession();
    if (!record) {
        return;
    }
    record.toolCallCount += 1;
    if (!event.success) {
        record.toolFailureCount += 1;
    }
    record.tools = record.tools ?? [];
    record.tools.push({ name: event.name, phase: record.currentPhase, latencyMs: event.latencyMs, success: event.success });
    if (record.tools.length > MAX_TOOL_ENTRIES) {
        record.tools.splice(0, record.tools.length - MAX_TOOL_ENTRIES);
    }
    await writeSession(record);
}

/** Marks the active run as using Autopilot (category 4). */
export async function markAutopilot(): Promise<void> {
    const record = readSession();
    if (!record) {
        return;
    }
    record.autopilot = true;
    await writeSession(record);
}

/** Records that an approval gate has opened and is awaiting the user (category 4). */
export async function markApprovalPending(): Promise<void> {
    const record = readSession();
    if (!record) {
        return;
    }
    record.approvalPendingAt = Date.now();
    await writeSession(record);
}

/** Records that the user granted an approval, accumulating the wait time (category 4). */
export async function recordApproval(): Promise<void> {
    const record = readSession();
    if (!record) {
        return;
    }
    record.approvalCount += 1;
    if (record.approvalPendingAt) {
        record.approvalWaitMs += Math.max(0, Date.now() - record.approvalPendingAt);
        record.approvalPendingAt = undefined;
    }
    await writeSession(record);
}

/** Records a feedback/revision round-trip within a phase (category 4). */
export async function recordRevision(): Promise<void> {
    const record = readSession();
    if (!record) {
        return;
    }
    record.revisionCount += 1;
    await writeSession(record);
}

/**
 * Read-only tags describing the active phase for piggy-backing onto other
 * telemetry (e.g. per-tool-call events). Returns `undefined` values when no run
 * is active.
 */
export function getActiveWorkflowTags(): { phase?: string; agent?: string; sessionId?: string } {
    const record = readSession();
    if (!record) {
        return {};
    }
    return { phase: record.currentPhase, agent: record.lastAgent, sessionId: record.sessionId };
}

/** Category 4 (friction) counters for the run currently in progress. */
export interface ActiveWorkflowFriction {
    autopilot: boolean;
    approvalCount: number;
    approvalWaitMs: number;
    revisionCount: number;
    safetyTimerFired: boolean;
}

/**
 * Snapshot of the active run's friction counters (approval waits, revisions,
 * autopilot), or `undefined` when no run is in progress. These live only in the
 * transient in-memory/`workspaceState` session record and are cleared when the
 * run finalizes, so callers must treat them as best-effort.
 */
export function getActiveWorkflowFriction(): ActiveWorkflowFriction | undefined {
    const record = readSession();
    if (!record) {
        return undefined;
    }
    return {
        autopilot: record.autopilot ?? false,
        approvalCount: record.approvalCount ?? 0,
        approvalWaitMs: record.approvalWaitMs ?? 0,
        revisionCount: record.revisionCount ?? 0,
        safetyTimerFired: record.safetyTimerFired ?? false,
    };
}

async function finalizeAndClear(outcome: WorkflowOutcome, endedAt: number, record: WorkflowSessionRecord): Promise<void> {
    // Fold the in-flight phase's elapsed time into its bucket before summarizing.
    const finalDuration = Math.max(0, endedAt - record.phaseStartedAt);
    record.phaseDurationsMs[record.currentPhase] = (record.phaseDurationsMs[record.currentPhase] ?? 0) + finalDuration;
    await emitSessionSummary(record, outcome, endedAt);
    // Merge in the agent's tool calls captured by the diagnostics hooks (if any);
    // they're a superset of the extension-measured tools, so prefer them.
    const hookTools = await readHookToolEvents(record.sessionId);
    const tools = hookTools.length > 0 ? hookTools : (record.tools ?? []);
    // Local-only, human-readable diagnostics report (includes the prompt).
    await writeDiagnosticsReport(await buildEnrichedRecord(record, outcome, endedAt, tools));
    await cleanupHookRuntime(record.sessionId);
    await writeSession(undefined);
    clearSafetyTimer();
    disposeCompletionWatchers();
}

/**
 * Builds the full local diagnostics record: base timings + tool stats +
 * friction + environment/quality signals (categories 1-6).
 */
async function buildEnrichedRecord(record: WorkflowSessionRecord, outcome: DiagnosticsOutcome, endedAt: number, tools: DiagnosticsToolEntry[]): Promise<WorkflowDiagnosticsRecord> {
    const base = toDiagnosticsRecord(record, outcome, endedAt, tools);
    const toolStats = computeToolStats(tools, base.phases);
    const approvalWaitMs = record.approvalWaitMs ?? 0;
    base.friction = {
        autopilot: record.autopilot ?? false,
        approvalCount: record.approvalCount ?? 0,
        approvalWaitMs,
        activeMs: Math.max(0, base.totalDurationMs - approvalWaitMs),
        revisionCount: record.revisionCount ?? 0,
        questionsAsked: toolStats.byCategory.question ?? 0,
        safetyTimerFired: record.safetyTimerFired ?? false,
    };
    base.toolStats = toolStats;
    try {
        const signals = await collectRunSignals(record.autopilot ?? false);
        base.environment = signals.environment;
        base.quality = signals.quality;
    } catch {
        // Best effort — a partial report is still useful.
    }
    try {
        // Trace the run back to the Copilot chat session logs that drove it.
        base.copilotChat = await collectCopilotChatSessions(record.startedAt, endedAt);
    } catch {
        // Best effort — the log directory may be unavailable.
    }
    return base;
}

/**
 * Converts an internal session record into a local-only diagnostics record.
 * `endedAt` is ignored for in-progress snapshots (the run is still open).
 */
function toDiagnosticsRecord(record: WorkflowSessionRecord, outcome: DiagnosticsOutcome, endedAt: number, tools: DiagnosticsToolEntry[]): WorkflowDiagnosticsRecord {
    const durations: Partial<Record<WorkflowPhase, number>> = { ...record.phaseDurationsMs };
    if (outcome === 'in-progress') {
        durations[record.currentPhase] = (durations[record.currentPhase] ?? 0) + Math.max(0, endedAt - record.phaseStartedAt);
    }
    const phaseAgents = record.phaseAgents ?? {};
    const phases = WORKFLOW_PHASES.map((phase) => {
        const durationMs = durations[phase] ?? 0;
        let status: 'completed' | 'active' | 'notReached';
        if (phase === record.currentPhase) {
            status = outcome === 'completed' ? 'completed' : 'active';
        } else if (durations[phase] !== undefined) {
            status = 'completed';
        } else {
            status = 'notReached';
        }
        return { phase, agent: phaseAgents[phase], durationMs, status };
    });
    return {
        sessionId: record.sessionId,
        prompt: record.prompt,
        startedAt: record.startedAt,
        endedAt: outcome === 'in-progress' ? undefined : endedAt,
        outcome,
        stoppedAtPhase: outcome === 'completed' ? undefined : record.currentPhase,
        totalDurationMs: Math.max(0, endedAt - record.startedAt),
        phases,
        toolCallCount: tools.length,
        toolFailureCount: tools.filter((t) => !t.success).length,
        tools,
    };
}

/**
 * Returns a diagnostics snapshot of the run currently in progress, or
 * `undefined` when no run is active. Used to render an on-demand report before
 * the run has finished. This sync variant reflects only extension-measured
 * tools; use {@link getActiveDiagnosticsReport} to also merge hook-captured
 * tool calls.
 */
export function getActiveDiagnosticsRecord(): WorkflowDiagnosticsRecord | undefined {
    const record = readSession();
    if (!record) {
        return undefined;
    }
    return toDiagnosticsRecord(record, 'in-progress', Date.now(), record.tools ?? []);
}

/**
 * Async snapshot of the in-progress run that also merges the agent tool calls
 * captured by the diagnostics hooks.
 */
export async function getActiveDiagnosticsReport(): Promise<WorkflowDiagnosticsRecord | undefined> {
    const record = readSession();
    if (!record) {
        return undefined;
    }
    const hookTools = await readHookToolEvents(record.sessionId);
    const tools = hookTools.length > 0 ? hookTools : (record.tools ?? []);
    return buildEnrichedRecord(record, 'in-progress', Date.now(), tools);
}

/** Ends the active session with the given outcome, if one is open. */
export async function completeSession(outcome: WorkflowOutcome): Promise<void> {
    const record = readSession();
    if (!record) {
        return;
    }
    await finalizeAndClear(outcome, Date.now(), record);
}

function clearSafetyTimer(): void {
    if (safetyTimer) {
        clearTimeout(safetyTimer);
        safetyTimer = undefined;
    }
}

function armSafetyTimer(deadline: number): void {
    clearSafetyTimer();
    const ms = Math.max(0, deadline - Date.now());
    safetyTimer = setTimeout(() => {
        void (async () => {
            const record = readSession();
            if (record) {
                record.safetyTimerFired = true;
                await writeSession(record);
                await finalizeAndClear('abandoned', Date.now(), record);
            }
        })();
    }, ms);
}

function disposeCompletionWatchers(): void {
    for (const w of completionWatchers) {
        w.dispose();
    }
    completionWatchers = [];
}

/** True when the deployment plan's status line indicates the run is finished. */
export function isDeploymentComplete(content: string): boolean {
    return /status\b[^a-z0-9]{0,8}(implemented|deployed|complete|completed)\b/i.test(content);
}

/**
 * Watches the terminal artifacts (`.azure/vscode-debug-plan.md` reaching
 * "Implemented" and `.azure/deployment-plan.md` reaching a deployed/complete
 * status) and marks the session completed when either is observed.
 */
function registerCompletionWatchers(): void {
    if (completionWatchers.length > 0) {
        return;
    }
    const watch = (glob: string, isDone: (content: string) => boolean): void => {
        const watcher = vscode.workspace.createFileSystemWatcher(glob);
        const check = async (uri: vscode.Uri): Promise<void> => {
            let content: string;
            try {
                content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
            } catch {
                return;
            }
            if (isDone(content)) {
                await completeSession('completed');
            }
        };
        watcher.onDidCreate((uri) => void check(uri));
        watcher.onDidChange((uri) => void check(uri));
        completionWatchers.push(watcher);
        ext.context.subscriptions.push(watcher);
    };
    watch(DEBUG_PLAN_FILE_GLOB, isDebugPlanImplemented);
    watch(DEPLOY_PLAN_GLOB, isDeploymentComplete);
}

/**
 * On activation, close out a stale session left over from a window that never
 * completed its run. A session still within its deadline (e.g. a legitimate
 * window reload mid-run) is kept and its watchers/timer re-armed.
 */
export function initializeWorkflowTelemetry(context: vscode.ExtensionContext): void {
    const record = ext.context.workspaceState.get<WorkflowSessionRecord>(STATE_SESSION);
    if (!record) {
        return;
    }
    if (Date.now() > record.deadline) {
        void finalizeAndClear('abandoned', record.deadline, record);
        return;
    }
    // Legitimate mid-run reload: resume tracking.
    armSafetyTimer(record.deadline);
    registerCompletionWatchers();
    context.subscriptions.push({ dispose: () => { clearSafetyTimer(); disposeCompletionWatchers(); } });
}
