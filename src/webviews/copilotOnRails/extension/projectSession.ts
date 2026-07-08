/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { azureDebugGenerateAgent, azureDebugPlanAgent, azureDeployAgent, azureProjectIntegrateAgent, azureProjectPlanAgent, azureProjectScaffoldAgent } from '../../../constants';
import { ext } from '../../../extensionVariables';

/**
 * Single, extension-owned source of truth for where the user is in the
 * "Create with Copilot" flow, so an interrupted run (window reload, crash,
 * abandoned chat session) can be resumed from the correct phase.
 *
 * Ownership model: the extension writes this record itself, at the one moment it
 * has authoritative knowledge — when it launches a phase's chat agent. It never
 * asks the agent to report progress and never parses the `.azure/*` files to
 * infer state. Those files are *work products* referenced as context when
 * resuming, not the authority for which phase we are in. This keeps a single,
 * unambiguous record even though several plan artifacts exist on disk.
 *
 * Granularity is deliberately phase-level: the extension can only observe phase
 * *launches*, not the sub-steps an agent performs within a phase. Resuming
 * re-opens the phase's agent seeded with the relevant artifact paths and a
 * "continue, don't restart" instruction, letting the agent re-orient itself
 * within the phase by reading those files.
 */

/** Phases of the create-with-copilot flow, in order. */
export type ProjectPhase =
    | 'plan'
    | 'scaffold'
    | 'integrate'
    | 'localDev'
    | 'deploy';

/** The persisted session record. Stored under a single `workspaceState` key. */
export interface CopilotSessionState {
    /** The phase whose agent was last launched in this workspace. */
    phase: ProjectPhase;
    /** When the record was last written (epoch ms). */
    updatedAt: number;
    /** Workspace-relative `.azure/*` artifacts to reference when resuming this phase. */
    contextRefs: string[];
}

/** The single workspaceState key holding {@link CopilotSessionState}. */
const SESSION_KEY = 'azureResourceGroups.copilotOnRails.session';

interface PhaseConfig {
    /** Chat agent that drives this phase (used as the `mode` when resuming). */
    readonly agent: string;
    /** Short, human-readable description of the phase. */
    readonly label: string;
    /** Workspace-relative artifacts the phase produces/consumes. */
    readonly contextRefs: string[];
}

/** Static configuration for each phase: which agent drives it and its artifacts. */
const PHASE_CONFIG: Readonly<Record<ProjectPhase, PhaseConfig>> = {
    plan: {
        agent: azureProjectPlanAgent,
        label: vscode.l10n.t('Project planning'),
        contextRefs: ['.azure/requirements.json', '.azure/project-plan.md'],
    },
    scaffold: {
        agent: azureProjectScaffoldAgent,
        label: vscode.l10n.t('Scaffolding'),
        contextRefs: ['.azure/project-plan.md'],
    },
    integrate: {
        agent: azureProjectIntegrateAgent,
        label: vscode.l10n.t('Live-data integration'),
        contextRefs: ['.azure/integration-plan.md', '.azure/project-plan.md'],
    },
    localDev: {
        agent: azureDebugPlanAgent,
        label: vscode.l10n.t('Local development setup'),
        contextRefs: ['.azure/vscode-debug-plan.md'],
    },
    deploy: {
        agent: azureDeployAgent,
        label: vscode.l10n.t('Deployment'),
        contextRefs: ['.azure/deployment-plan.md'],
    },
};

/** Maps a launched chat agent name to the flow phase it advances. */
const AGENT_PHASE: Readonly<Record<string, ProjectPhase>> = {
    [azureProjectPlanAgent]: 'plan',
    [azureProjectScaffoldAgent]: 'scaffold',
    [azureProjectIntegrateAgent]: 'integrate',
    [azureDebugPlanAgent]: 'localDev',
    [azureDebugGenerateAgent]: 'localDev',
    [azureDeployAgent]: 'deploy',
};

/**
 * In-memory marker: set once any phase is launched in THIS window, and
 * deliberately NOT persisted. A window reload — the main way a run gets
 * interrupted — clears it, which is exactly the signal that distinguishes "a
 * flow is being actively driven right now" (don't offer resume) from "a flow was
 * launched earlier and the window has since been reloaded" (offer resume).
 */
let sessionActiveInWindow = false;

const onDidChangeSessionEmitter = new vscode.EventEmitter<void>();
/**
 * Fires whenever the persisted session record or the in-memory active flag
 * changes, so the resume affordance can re-evaluate immediately instead of
 * waiting for the next unrelated refresh.
 */
export const onDidChangeSession = onDidChangeSessionEmitter.event;

/** Reads the current session record, or `undefined` when no flow has started. */
export function readSessionState(): CopilotSessionState | undefined {
    return ext.context.workspaceState.get<CopilotSessionState>(SESSION_KEY);
}

async function writeSessionState(state: CopilotSessionState | undefined): Promise<void> {
    await ext.context.workspaceState.update(SESSION_KEY, state);
    onDidChangeSessionEmitter.fire();
}

/**
 * Records that a phase's chat agent was just launched. This is the only writer
 * of forward progress: called from every place that starts a phase agent, so an
 * interrupted run can later be resumed from the correct phase.
 */
export async function recordPhase(phase: ProjectPhase): Promise<void> {
    sessionActiveInWindow = true;
    await writeSessionState({
        phase,
        updatedAt: Date.now(),
        contextRefs: PHASE_CONFIG[phase].contextRefs,
    });
}

/** Records a phase launch given the chat agent name. No-op for unknown agents. */
export async function recordAgentLaunch(agentName: string): Promise<void> {
    const phase = AGENT_PHASE[agentName];
    if (phase) {
        await recordPhase(phase);
    }
}

/** Clears the session record and the in-memory active flag. */
export async function clearSession(): Promise<void> {
    const changed = sessionActiveInWindow || readSessionState() !== undefined;
    sessionActiveInWindow = false;
    if (readSessionState() !== undefined) {
        await ext.context.workspaceState.update(SESSION_KEY, undefined);
    }
    if (changed) {
        onDidChangeSessionEmitter.fire();
    }
}

/**
 * A phase hand-off programmatically closes the current planning/requirements
 * view before opening the next one. That dispose must NOT be read as the user
 * abandoning the flow, so callers set this one-shot flag immediately before such
 * a dispose; it is consumed by the next {@link handleTrackedViewClosed} call.
 */
let suppressNextTrackedViewClose = false;

/** Marks the next tracked-view close as a programmatic phase hand-off, not a user close. */
export function suppressTrackedViewCloseOnce(): void {
    suppressNextTrackedViewClose = true;
}

/**
 * Called when a tracked planning/requirements view (project plan, debug plan, or
 * requirements) is disposed. Closing one of these views is how the user signals
 * they're done with the flow, so the session is cleared — unless the dispose was
 * a programmatic phase hand-off flagged via {@link suppressTrackedViewCloseOnce}.
 *
 * NOTE: Ideally closing the active Copilot *chat* session that is driving a phase
 * would also end the project session. That isn't wired up yet: the flow launches
 * agents via the fire-and-forget `workbench.action.chat.open` /
 * `workbench.action.chat.newChat` commands, which return no session handle, and
 * stable VS Code exposes no event for a chat session being closed/cleared.
 * Detecting it would require opting into the proposed chat-session API
 * (`enabledApiProposals`, e.g. `chatSessionsProvider`/`chatProvider`) to capture
 * a chat session id and observe its disposal — which only runs in Insiders/dev
 * builds, not stable Marketplace releases. Deferred until a stable API exists.
 */
export async function handleTrackedViewClosed(): Promise<void> {
    if (suppressNextTrackedViewClose) {
        suppressNextTrackedViewClose = false;
        return;
    }
    await clearSession();
}

/** True while a create-with-copilot phase is being driven in this window. */
export function isSessionActiveInWindow(): boolean {
    return sessionActiveInWindow;
}

/**
 * Whether the resume affordance should be offered: a record exists and the flow
 * is not currently being driven in this window (i.e. it was launched earlier and
 * the window has since been reloaded, or a fresh window opened this workspace).
 */
export function shouldOfferResume(state: CopilotSessionState | undefined): state is CopilotSessionState {
    return !!state && !sessionActiveInWindow;
}

/** Human-readable label for a phase, e.g. for the status-bar tooltip. */
export function phaseLabel(phase: ProjectPhase): string {
    return PHASE_CONFIG[phase].label;
}

/** The chat agent (`mode`) that drives a phase — used when resuming it. */
export function resumeAgentFor(phase: ProjectPhase): string {
    return PHASE_CONFIG[phase].agent;
}

/**
 * Builds the "continue, don't restart" prompt used when resuming a phase. It
 * names the phase's artifacts so the agent re-orients itself by reading them,
 * which is how phase-level tracking still yields a sensible mid-phase resume
 * without the extension having to know the agent's sub-progress.
 */
export function buildResumePrompt(state: CopilotSessionState): string {
    const refs = state.contextRefs.map((r) => `\`${r}\``).join(', ');
    return vscode.l10n.t(
        'Resume the {0} phase of this Copilot project. Read the existing project artifacts ({1}) to determine what has already been done, then continue from where it left off. Do NOT restart the project or re-gather information the artifacts already capture.',
        phaseLabel(state.phase),
        refs,
    );
}
