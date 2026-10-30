/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { v4 as uuidv4 } from 'uuid';
import { ext } from '../../extensionVariables';

export const COR_TELEMETRY_SCHEMA_VERSION = '2';
/** Increment when the shipped CoR agent/instruction bundle changes in a telemetry-significant way. */
export const COR_AGENT_BUNDLE_VERSION = '1';
/** Increment when the CoR launch prompt contract changes in a telemetry-significant way. */
export const COR_PROMPT_VERSION = '1';
export const COR_WORKFLOW_STATE_KEY = 'azureResourceGroups.copilotOnRails.workflow';

export type CorWorkflowEntryPoint =
    | 'background'
    | 'createProject'
    | 'extensionCommand'
    | 'folderHandoff'
    | 'mcpTool'
    | 'phaseHandoff'
    | 'reloadResume'
    | 'resume'
    | 'retry'
    | 'webview';

export type CorWorkflowPhase = 'plan' | 'scaffold' | 'integrate' | 'debug' | 'deploy';
export type CorLifecycleState = 'started' | 'succeeded' | 'failed' | 'canceled' | 'skipped';

export interface CorPhaseRunState {
    phase: CorWorkflowPhase;
    phaseRunId: string;
    parentPhaseRunId?: string;
    artifactId?: string;
    attemptNumber: number;
    retryCount: number;
    entryPoint: CorWorkflowEntryPoint;
    lifecycleState: CorLifecycleState;
    startedAt: number;
    completedAt?: number;
    failureCategory?: string;
    cancelReason?: string;
    skipReason?: string;
}

export interface CorWorkflowState {
    schemaVersion: typeof COR_TELEMETRY_SCHEMA_VERSION;
    workflowRunId: string;
    entryPoint: CorWorkflowEntryPoint;
    lifecycleState: CorLifecycleState;
    startedAt: number;
    completedAt?: number;
    failureCategory?: string;
    cancelReason?: string;
    skipReason?: string;
    phaseAttempts: Partial<Record<CorWorkflowPhase, number>>;
    currentPhase?: CorPhaseRunState;
    modelRequestCount: number;
    toolCallCount: number;
    toolDurationMs: number;
    toolDurationsMs: Record<string, number>;
    userWaitDurationMs: number;
    waitingSince?: number;
}

export interface CorWorkflowHandoff {
    schemaVersion: typeof COR_TELEMETRY_SCHEMA_VERSION;
    workflowRunId: string;
    entryPoint: CorWorkflowEntryPoint;
    startedAt: number;
    userWaitDurationMs: number;
}

export interface CorWorkflowTelemetry {
    properties: Record<string, string>;
    measurements: Record<string, number>;
}

const workflowEntryPoints = new Set<CorWorkflowEntryPoint>([
    'background',
    'createProject',
    'extensionCommand',
    'folderHandoff',
    'mcpTool',
    'phaseHandoff',
    'reloadResume',
    'resume',
    'retry',
    'webview',
]);

const phases = new Set<CorWorkflowPhase>(['plan', 'scaffold', 'integrate', 'debug', 'deploy']);
const lifecycleStates = new Set<CorLifecycleState>(['started', 'succeeded', 'failed', 'canceled', 'skipped']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const knownToolNames = new Set([
    'capture_deployment_inventory',
    'close_database_migration_access',
    'open_database_migration_access',
    'open_deploy_plan_view',
    'open_deploy_result_view',
    'open_frontend_preview_view',
    'open_local_next_steps_view',
    'open_local_plan_view',
    'open_plan_view',
    'open_requirements_view',
    'open_scaffold_next_steps_view',
    'record_deploy_prerequisites',
    'report_agent_launch',
    'start_azure_debug_generate',
    'start_deployment',
    'start_local_development',
    'start_project_integrate',
    'start_project_scaffold',
]);

let updateQueue: Promise<void> = Promise.resolve();

export function createCorWorkflowState(
    entryPoint: CorWorkflowEntryPoint,
    now: number = Date.now(),
    workflowRunId: string = uuidv4(),
): CorWorkflowState {
    return {
        schemaVersion: COR_TELEMETRY_SCHEMA_VERSION,
        workflowRunId,
        entryPoint,
        lifecycleState: 'started',
        startedAt: now,
        phaseAttempts: {},
        modelRequestCount: 0,
        toolCallCount: 0,
        toolDurationMs: 0,
        toolDurationsMs: {},
        userWaitDurationMs: 0,
    };
}

export function beginCorPhaseInState(
    state: CorWorkflowState,
    phase: CorWorkflowPhase,
    entryPoint: CorWorkflowEntryPoint,
    now: number = Date.now(),
    phaseRunId: string = uuidv4(),
): CorWorkflowState {
    if (state.lifecycleState !== 'started') {
        return state;
    }
    if (state.currentPhase?.phase === phase && state.currentPhase.lifecycleState === 'started' && entryPoint !== 'resume' && entryPoint !== 'retry') {
        return state;
    }
    const attemptNumber = (state.phaseAttempts[phase] ?? 0) + 1;
    return {
        ...state,
        lifecycleState: 'started',
        completedAt: undefined,
        phaseAttempts: { ...state.phaseAttempts, [phase]: attemptNumber },
        currentPhase: {
            phase,
            phaseRunId,
            ...(state.currentPhase ? { parentPhaseRunId: state.currentPhase.phaseRunId } : {}),
            attemptNumber,
            retryCount: attemptNumber - 1,
            entryPoint,
            lifecycleState: 'started',
            startedAt: now,
        },
    };
}

export function completeCorPhaseInState(
    state: CorWorkflowState,
    phase: CorWorkflowPhase,
    lifecycleState: Exclude<CorLifecycleState, 'started'>,
    details: Pick<CorPhaseRunState, 'failureCategory' | 'cancelReason' | 'skipReason'> = {},
    now: number = Date.now(),
): CorWorkflowState {
    const currentPhase = state.currentPhase;
    if (state.lifecycleState !== 'started' || !currentPhase || currentPhase.phase !== phase || currentPhase.lifecycleState !== 'started') {
        return state;
    }
    const settledState = settleCorWorkflowWaitInState(state, now);
    const workflowIsTerminal = phase === 'deploy';
    return {
        ...settledState,
        ...(workflowIsTerminal ? { lifecycleState, completedAt: now } : {}),
        currentPhase: {
            ...currentPhase,
            lifecycleState,
            completedAt: now,
            ...details,
        },
    };
}

export function completeCorWorkflowInState(
    state: CorWorkflowState,
    lifecycleState: Exclude<CorLifecycleState, 'started'>,
    details: Pick<CorWorkflowState, 'failureCategory' | 'cancelReason' | 'skipReason'> = {},
    now: number = Date.now(),
): CorWorkflowState {
    if (state.lifecycleState !== 'started') {
        return state;
    }
    const settledState = settleCorWorkflowWaitInState(state, now);
    return {
        ...settledState,
        lifecycleState,
        completedAt: now,
        ...details,
    };
}

export function ensureCorWorkflowInState(
    state: CorWorkflowState | undefined,
    entryPoint: CorWorkflowEntryPoint,
    now: number = Date.now(),
    workflowRunId: string = uuidv4(),
): CorWorkflowState {
    return !state || entryPoint === 'createProject'
        ? createCorWorkflowState(entryPoint, now, workflowRunId)
        : state;
}

export function restoreCorWorkflowHandoffInState(
    state: CorWorkflowState | undefined,
    handoff: CorWorkflowHandoff,
): CorWorkflowState {
    if (state?.workflowRunId === handoff.workflowRunId) {
        return state;
    }
    return {
        ...createCorWorkflowState(handoff.entryPoint, handoff.startedAt, handoff.workflowRunId),
        userWaitDurationMs: handoff.userWaitDurationMs,
    };
}

export function markCorWorkflowWaitingInState(state: CorWorkflowState, now: number = Date.now()): CorWorkflowState {
    return state.lifecycleState === 'started' && state.waitingSince === undefined
        ? { ...state, waitingSince: now }
        : state;
}

export function recordCorUserWaitInState(state: CorWorkflowState, durationMs: number): CorWorkflowState {
    if (state.lifecycleState !== 'started' || !Number.isFinite(durationMs) || durationMs <= 0) {
        return state;
    }
    return {
        ...state,
        userWaitDurationMs: state.userWaitDurationMs + Math.round(durationMs),
    };
}

export function shouldConsumeCorUserWait(entryPoint: CorWorkflowEntryPoint, override?: boolean): boolean {
    return override ?? entryPoint !== 'background';
}

export function isCorPhaseBoundToArtifact(
    state: CorWorkflowState | undefined,
    phase: CorWorkflowPhase,
    artifactId: string,
): boolean {
    return state?.lifecycleState === 'started'
        && state.currentPhase?.lifecycleState === 'started'
        && state.currentPhase.phase === phase
        && state.currentPhase.artifactId === artifactId;
}

export function recordCorToolCallInState(state: CorWorkflowState, toolName: string, durationMs: number): CorWorkflowState {
    const normalizedToolName = normalizeCorToolName(toolName);
    const boundedDuration = nonnegativeFinite(durationMs);
    return {
        ...state,
        toolCallCount: state.toolCallCount + 1,
        toolDurationMs: state.toolDurationMs + boundedDuration,
        toolDurationsMs: {
            ...state.toolDurationsMs,
            [normalizedToolName]: (state.toolDurationsMs[normalizedToolName] ?? 0) + boundedDuration,
        },
    };
}

export function normalizeCorToolName(toolName: string): string {
    return knownToolNames.has(toolName) ? toolName : 'other';
}

export function getCorWorkflowTelemetryFromState(state: CorWorkflowState, now: number = Date.now()): CorWorkflowTelemetry {
    const effectiveNow = state.completedAt ?? now;
    const currentWaitMs = state.waitingSince === undefined || state.completedAt !== undefined
        ? 0
        : Math.max(0, effectiveNow - state.waitingSince);
    const workflowDurationMs = Math.max(0, effectiveNow - state.startedAt);
    const userWaitDurationMs = state.userWaitDurationMs + currentWaitMs;
    const properties: Record<string, string> = {
        telemetrySchemaVersion: state.schemaVersion,
        workflowRunId: state.workflowRunId,
        workflowEntryPoint: state.entryPoint,
        workflowStartedTimestamp: new Date(state.startedAt).toISOString(),
        workflowLifecycleState: state.lifecycleState,
        agentBundleVersion: COR_AGENT_BUNDLE_VERSION,
        agentBundleVersionAvailable: 'true',
        promptVersion: COR_PROMPT_VERSION,
        promptVersionAvailable: 'true',
    };
    if (state.completedAt !== undefined) {
        properties.workflowCompletedTimestamp = new Date(state.completedAt).toISOString();
    }
    if (state.failureCategory) {
        properties.workflowFailureCategory = state.failureCategory;
    }
    if (state.cancelReason) {
        properties.workflowCancelReason = state.cancelReason;
    }
    if (state.skipReason) {
        properties.workflowSkipReason = state.skipReason;
    }
    const measurements: Record<string, number> = {
        workflowDurationMs,
        workflowUserWaitDurationMs: userWaitDurationMs,
        workflowActiveDurationMs: Math.max(0, workflowDurationMs - userWaitDurationMs),
        modelRequestCount: state.modelRequestCount,
        toolCallCount: state.toolCallCount,
        toolDurationMs: state.toolDurationMs,
    };

    if (state.currentPhase) {
        properties.phase = state.currentPhase.phase;
        properties.phaseRunId = state.currentPhase.phaseRunId;
        properties.phaseEntryPoint = state.currentPhase.entryPoint;
        properties.phaseLifecycleState = state.currentPhase.lifecycleState;
        properties.phaseStartedTimestamp = new Date(state.currentPhase.startedAt).toISOString();
        properties.attemptNumber = String(state.currentPhase.attemptNumber);
        properties.retryCount = String(state.currentPhase.retryCount);
        if (state.currentPhase.parentPhaseRunId) {
            properties.parentPhaseRunId = state.currentPhase.parentPhaseRunId;
        }
        if (state.currentPhase.completedAt !== undefined) {
            properties.phaseCompletedTimestamp = new Date(state.currentPhase.completedAt).toISOString();
            measurements.phaseDurationMs = Math.max(0, state.currentPhase.completedAt - state.currentPhase.startedAt);
        }
        if (state.currentPhase.failureCategory) {
            properties.phaseFailureCategory = state.currentPhase.failureCategory;
        }
        if (state.currentPhase.cancelReason) {
            properties.phaseCancelReason = state.currentPhase.cancelReason;
        }
        if (state.currentPhase.skipReason) {
            properties.phaseSkipReason = state.currentPhase.skipReason;
        }
    }

    for (const [toolName, durationMs] of Object.entries(state.toolDurationsMs)) {
        measurements[`toolDurationMs.${normalizeCorToolName(toolName)}`] = durationMs;
    }

    return { properties, measurements };
}

export function parseCorWorkflowHandoff(value: unknown): CorWorkflowHandoff | undefined {
    if (!isObject(value)
        || value.schemaVersion !== COR_TELEMETRY_SCHEMA_VERSION
        || !isUuid(value.workflowRunId)
        || !isEntryPoint(value.entryPoint)
        || !isValidTimestamp(value.startedAt)
        || (value.userWaitDurationMs !== undefined && !isNonnegativeFinite(value.userWaitDurationMs))) {
        return undefined;
    }
    return {
        schemaVersion: COR_TELEMETRY_SCHEMA_VERSION,
        workflowRunId: value.workflowRunId,
        entryPoint: value.entryPoint,
        startedAt: value.startedAt,
        userWaitDurationMs: value.userWaitDurationMs ?? 0,
    };
}

export function getCorWorkflowState(): CorWorkflowState | undefined {
    return parseCorWorkflowState(ext.context.workspaceState.get<unknown>(COR_WORKFLOW_STATE_KEY));
}

export function getCorWorkflowHandoff(): CorWorkflowHandoff | undefined {
    const state = getCorWorkflowState();
    return state && {
        schemaVersion: state.schemaVersion,
        workflowRunId: state.workflowRunId,
        entryPoint: state.entryPoint,
        startedAt: state.startedAt,
        userWaitDurationMs: state.userWaitDurationMs,
    };
}

export async function ensureCorWorkflow(entryPoint: CorWorkflowEntryPoint): Promise<CorWorkflowState> {
    return await updateCorWorkflow((state) => ensureCorWorkflowInState(state, entryPoint));
}

export async function restoreCorWorkflowHandoff(handoff: CorWorkflowHandoff): Promise<CorWorkflowState> {
    return await updateCorWorkflow((state) => restoreCorWorkflowHandoffInState(state, handoff));
}

export async function beginCorPhase(phase: CorWorkflowPhase, entryPoint: CorWorkflowEntryPoint): Promise<CorWorkflowState> {
    return await updateCorWorkflow((state) => beginCorPhaseInState(state ?? createCorWorkflowState(entryPoint), phase, entryPoint));
}

export async function completeCorPhase(
    phase: CorWorkflowPhase,
    lifecycleState: Exclude<CorLifecycleState, 'started'>,
    details?: Pick<CorPhaseRunState, 'failureCategory' | 'cancelReason' | 'skipReason'>,
): Promise<boolean> {
    let changed = false;
    await updateCorWorkflow((state) => {
        if (!state) {
            return createCorWorkflowState('background');
        }
        const completed = completeCorPhaseInState(state, phase, lifecycleState, details);
        changed = completed !== state;
        return completed;
    });
    return changed;
}

export async function completeCorWorkflow(
    lifecycleState: Exclude<CorLifecycleState, 'started'>,
    details?: Pick<CorWorkflowState, 'failureCategory' | 'cancelReason' | 'skipReason'>,
): Promise<boolean> {
    let changed = false;
    await updateCorWorkflow((state) => {
        const current = state ?? createCorWorkflowState('background');
        const completed = completeCorWorkflowInState(current, lifecycleState, details);
        changed = completed !== current;
        return completed;
    });
    return changed;
}

export async function bindCorPhaseArtifactId(phase: CorWorkflowPhase, artifactId: string): Promise<boolean> {
    if (!isBoundedArtifactId(artifactId)) {
        return false;
    }
    let changed = false;
    await updateCorWorkflow((state) => {
        if (!state || state.lifecycleState !== 'started' || state.currentPhase?.phase !== phase || state.currentPhase.lifecycleState !== 'started') {
            return state ?? createCorWorkflowState('background');
        }
        if (state.currentPhase.artifactId === artifactId || state.currentPhase.artifactId !== undefined) {
            return state;
        }
        changed = true;
        return {
            ...state,
            currentPhase: {
                ...state.currentPhase,
                artifactId,
            },
        };
    });
    return changed;
}

export async function recordCorModelRequest(): Promise<CorWorkflowState> {
    return await updateCorWorkflow((state) => {
        const current = state ?? createCorWorkflowState('background');
        return { ...current, modelRequestCount: current.modelRequestCount + 1 };
    });
}

export async function recordCorToolCall(toolName: string, durationMs: number): Promise<CorWorkflowState> {
    return await updateCorWorkflow((state) => recordCorToolCallInState(state ?? createCorWorkflowState('mcpTool'), toolName, durationMs));
}

export async function markCorWorkflowWaiting(now: number = Date.now()): Promise<void> {
    await updateCorWorkflow((state) => {
        if (!state) {
            return createCorWorkflowState('background');
        }
        return markCorWorkflowWaitingInState(state, now);
    });
}

export async function resumeCorWorkflow(now: number = Date.now()): Promise<number> {
    let waitedMs = 0;
    await updateCorWorkflow((state) => {
        if (!state) {
            return createCorWorkflowState('background', now);
        }
        if (state.lifecycleState !== 'started' || state.waitingSince === undefined) {
            return state ?? createCorWorkflowState('background', now);
        }
        waitedMs = Math.max(0, now - state.waitingSince);
        return settleCorWorkflowWaitInState(state, now);
    });
    return waitedMs;
}

export async function recordCorUserWait(durationMs: number): Promise<void> {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
        return;
    }
    await updateCorWorkflow((state) => {
        const current = state ?? createCorWorkflowState('background');
        if (current.lifecycleState !== 'started') {
            return current;
        }
        return recordCorUserWaitInState(current, durationMs);
    });
}

export function getCorWorkflowTelemetry(now: number = Date.now()): CorWorkflowTelemetry | undefined {
    const state = getCorWorkflowState();
    return state ? getCorWorkflowTelemetryFromState(state, now) : undefined;
}

async function updateCorWorkflow(mutator: (state: CorWorkflowState | undefined) => CorWorkflowState): Promise<CorWorkflowState> {
    let result: CorWorkflowState | undefined;
    updateQueue = updateQueue.catch(() => undefined).then(async () => {
        result = mutator(getCorWorkflowState());
        await ext.context.workspaceState.update(COR_WORKFLOW_STATE_KEY, result);
    });
    await updateQueue;
    return result as CorWorkflowState;
}

function parseCorWorkflowState(value: unknown): CorWorkflowState | undefined {
    if (!isObject(value)
        || value.schemaVersion !== COR_TELEMETRY_SCHEMA_VERSION
        || !isUuid(value.workflowRunId)
        || !isEntryPoint(value.entryPoint)
        || !isLifecycleState(value.lifecycleState)
        || !isValidTimestamp(value.startedAt)
        || (value.completedAt !== undefined && !isValidTimestamp(value.completedAt))
        || !isObject(value.phaseAttempts)
        || !isNonnegativeFinite(value.modelRequestCount)
        || !isNonnegativeFinite(value.toolCallCount)
        || !isNonnegativeFinite(value.toolDurationMs)
        || !isObject(value.toolDurationsMs)
        || !isNonnegativeFinite(value.userWaitDurationMs)) {
        return undefined;
    }

    const phaseAttempts: Partial<Record<CorWorkflowPhase, number>> = {};
    for (const [phase, attempts] of Object.entries(value.phaseAttempts)) {
        if (isPhase(phase) && isNonnegativeFinite(attempts)) {
            phaseAttempts[phase] = attempts;
        }
    }

    const toolDurationsMs: Record<string, number> = {};
    for (const [toolName, durationMs] of Object.entries(value.toolDurationsMs)) {
        if (normalizeCorToolName(toolName) === toolName && isNonnegativeFinite(durationMs)) {
            toolDurationsMs[toolName] = durationMs;
        }
    }

    const currentPhase = parsePhaseRun(value.currentPhase);
    return {
        schemaVersion: COR_TELEMETRY_SCHEMA_VERSION,
        workflowRunId: value.workflowRunId,
        entryPoint: value.entryPoint,
        lifecycleState: value.lifecycleState,
        startedAt: value.startedAt,
        ...(value.completedAt !== undefined ? { completedAt: value.completedAt } : {}),
        ...(typeof value.failureCategory === 'string' ? { failureCategory: value.failureCategory } : {}),
        ...(typeof value.cancelReason === 'string' ? { cancelReason: value.cancelReason } : {}),
        ...(typeof value.skipReason === 'string' ? { skipReason: value.skipReason } : {}),
        phaseAttempts,
        ...(currentPhase ? { currentPhase } : {}),
        modelRequestCount: value.modelRequestCount,
        toolCallCount: value.toolCallCount,
        toolDurationMs: value.toolDurationMs,
        toolDurationsMs,
        userWaitDurationMs: value.userWaitDurationMs,
        ...(isValidTimestamp(value.waitingSince) ? { waitingSince: value.waitingSince } : {}),
    };
}

function parsePhaseRun(value: unknown): CorPhaseRunState | undefined {
    if (!isObject(value)
        || !isPhase(value.phase)
        || !isUuid(value.phaseRunId)
        || (value.parentPhaseRunId !== undefined && !isUuid(value.parentPhaseRunId))
        || (value.artifactId !== undefined && !isBoundedArtifactId(value.artifactId))
        || !isNonnegativeFinite(value.attemptNumber)
        || !isNonnegativeFinite(value.retryCount)
        || !isEntryPoint(value.entryPoint)
        || !isLifecycleState(value.lifecycleState)
        || !isValidTimestamp(value.startedAt)
        || (value.completedAt !== undefined && !isValidTimestamp(value.completedAt))) {
        return undefined;
    }
    return {
        phase: value.phase,
        phaseRunId: value.phaseRunId,
        ...(value.parentPhaseRunId ? { parentPhaseRunId: value.parentPhaseRunId } : {}),
        ...(value.artifactId ? { artifactId: value.artifactId } : {}),
        attemptNumber: value.attemptNumber,
        retryCount: value.retryCount,
        entryPoint: value.entryPoint,
        lifecycleState: value.lifecycleState,
        startedAt: value.startedAt,
        ...(value.completedAt !== undefined ? { completedAt: value.completedAt } : {}),
        ...(typeof value.failureCategory === 'string' ? { failureCategory: value.failureCategory } : {}),
        ...(typeof value.cancelReason === 'string' ? { cancelReason: value.cancelReason } : {}),
        ...(typeof value.skipReason === 'string' ? { skipReason: value.skipReason } : {}),
    };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
    return typeof value === 'string' && uuidPattern.test(value);
}

function isEntryPoint(value: unknown): value is CorWorkflowEntryPoint {
    return typeof value === 'string' && workflowEntryPoints.has(value as CorWorkflowEntryPoint);
}

function isPhase(value: unknown): value is CorWorkflowPhase {
    return typeof value === 'string' && phases.has(value as CorWorkflowPhase);
}

function isLifecycleState(value: unknown): value is CorLifecycleState {
    return typeof value === 'string' && lifecycleStates.has(value as CorLifecycleState);
}

function isNonnegativeFinite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isValidTimestamp(value: unknown): value is number {
    return isNonnegativeFinite(value) && value <= 8_640_000_000_000_000;
}

function isBoundedArtifactId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._-]+$/.test(value);
}

export function settleCorWorkflowWaitInState(state: CorWorkflowState, now: number): CorWorkflowState {
    if (state.lifecycleState !== 'started' || state.waitingSince === undefined) {
        return state;
    }
    return {
        ...state,
        userWaitDurationMs: state.userWaitDurationMs + Math.max(0, now - state.waitingSince),
        waitingSince: undefined,
    };
}

function nonnegativeFinite(value: number): number {
    return Number.isFinite(value) && value >= 0 ? value : 0;
}
