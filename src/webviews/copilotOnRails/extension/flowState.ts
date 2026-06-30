/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { copilotOnRailsCommandIds } from './copilotOnRailsCommands';
import { DEBUG_PLAN_GLOB, DEPLOYMENT_PLAN_GLOB, PROJECT_PLAN_GLOB, REQUIREMENTS_GLOB } from './planFilePaths';

/**
 * Tracks where the user is in the "Create with Copilot" flow so an interrupted
 * run (window reload, crash, abandoned chat session) can be resumed from the
 * correct phase without the user having to guess which chat session to reopen.
 *
 * Reliability model: the `.azure/*` plan files written by the agents are the
 * source of truth, because they are produced by the actor doing the work at the
 * moment the work happens. `workspaceState` is only a reconciled cache that adds
 * information the files can't carry (which phase we last *launched* — needed to
 * tell "plan awaiting approval" apart from "scaffold mid-run" — and whether the
 * user dismissed the resume prompt for the current phase). On every read we
 * reconcile and the files win.
 */

/** Phases of the create-with-copilot flow, in order. */
export type FlowPhase =
    | 'requirements'
    | 'plan'
    | 'scaffold'
    | 'integrate'
    | 'localDev'
    | 'deploy';

export type FlowStatus = 'inProgress' | 'awaitingInput' | 'awaitingApproval' | 'completed';

export interface FlowState {
    phase: FlowPhase;
    status: FlowStatus;
    /** Command to invoke to resume (or continue from) this phase. */
    resumeCommandId: string;
    /** Arguments to pass to {@link resumeCommandId} (e.g. a resume-specific prompt). */
    resumeArgs?: unknown[];
    /** Short human-readable description of the current phase. */
    label: string;
}

const LAST_PHASE_KEY = 'azureResourceGroups.copilotFlow.lastPhase';
const PROMPT_DISMISSED_PHASE_KEY = 'azureResourceGroups.copilotFlow.promptDismissedForPhase';

/**
 * Prompt used when resuming an interrupted scaffold. The plan was already
 * approved upstream — its status has advanced to `In Progress` (Approved → In
 * Progress is the expected chain for a run that was interrupted mid-scaffold).
 * The agent must therefore NOT re-gather requirements or re-request approval; it
 * should read the existing plan and continue scaffolding from where it left off.
 */
const SCAFFOLD_RESUME_PROMPT = 'Resume scaffolding this project. `.azure/project-plan.md` was already approved and its status is now `In Progress` (Approved → In Progress is expected for an interrupted run — treat `In Progress` as a valid, resumable state). Do NOT re-gather requirements or ask for approval again. Read the existing plan and continue scaffolding from where it left off.';

/** Maps a launched agent name to the flow phase it advances. */
const AGENT_PHASE: Readonly<Record<string, FlowPhase>> = {
    'azure-project-plan': 'plan',
    'azure-project-scaffold': 'scaffold',
    'azure-project-integrate': 'integrate',
    'azure-debug-plan': 'localDev',
    'azure-debug-generate': 'localDev',
    'azure-deploy': 'deploy',
};

/** Maps a flow phase to the progress-tree stage index it belongs to. */
export function phaseToStageIndex(phase: FlowPhase): 0 | 1 | 2 {
    switch (phase) {
        case 'requirements':
        case 'plan':
        case 'scaffold':
        case 'integrate':
            return 0;
        case 'localDev':
            return 1;
        case 'deploy':
            return 2;
    }
}

/**
 * Records that a phase's chat agent was just launched. Called from every place
 * that starts a phase agent so an interrupted run can be detected later (the
 * phase was launched but its completion file never appeared).
 */
export async function recordPhaseLaunch(phase: FlowPhase): Promise<void> {
    const state = ext.context.workspaceState;
    await state.update(LAST_PHASE_KEY, phase);
    // A new phase started — re-enable the resume prompt for it.
    if (state.get<FlowPhase>(PROMPT_DISMISSED_PHASE_KEY) !== phase) {
        await state.update(PROMPT_DISMISSED_PHASE_KEY, undefined);
    }
}

/** Records a phase launch given the chat agent name. No-op for unknown agents. */
export async function recordAgentLaunch(agentName: string): Promise<void> {
    const phase = AGENT_PHASE[agentName];
    if (phase) {
        await recordPhaseLaunch(phase);
    }
}

/**
 * Resolves the current flow state from the `.azure/*` plan files (source of
 * truth), using the cached last-launched phase only to disambiguate states that
 * the files alone can't (e.g. plan approved vs. scaffold still running).
 * Returns `undefined` when no flow has been started.
 */
export async function resolveFlowState(): Promise<FlowState | undefined> {
    const [hasRequirements, projectPlanStatus, debugPlanStatus, hasDeploymentPlan] = await Promise.all([
        fileExists(REQUIREMENTS_GLOB),
        readStatus(PROJECT_PLAN_GLOB),
        readStatus(DEBUG_PLAN_GLOB),
        fileExists(DEPLOYMENT_PLAN_GLOB),
    ]);

    const lastPhase = ext.context.workspaceState.get<FlowPhase>(LAST_PHASE_KEY);

    return computeFlowState({ hasRequirements, projectPlanStatus, debugPlanStatus, hasDeploymentPlan, lastPhase });
}

/** Inputs to {@link computeFlowState}, gathered from disk and the state cache. */
export interface FlowSignals {
    hasRequirements: boolean;
    /** Lowercased `Status:` of `.azure/project-plan.md`, or undefined if absent. */
    projectPlanStatus: string | undefined;
    /** Lowercased `Status:` of `.azure/vscode-debug-plan.md`, or undefined if absent. */
    debugPlanStatus: string | undefined;
    hasDeploymentPlan: boolean;
    /** The phase whose agent was last launched in this workspace, if any. */
    lastPhase: FlowPhase | undefined;
}

/**
 * Pure decision logic mapping the observed signals to a resumable flow state.
 * The plan files are the source of truth; `lastPhase` is only used to tell
 * otherwise-identical file states apart (e.g. plan awaiting approval vs. an
 * interrupted scaffold). Returns `undefined` when no flow has been started.
 */
export function computeFlowState(signals: FlowSignals): FlowState | undefined {
    const { hasRequirements, projectPlanStatus, debugPlanStatus, hasDeploymentPlan, lastPhase } = signals;

    // Deployment is the last stage.
    if (hasDeploymentPlan) {
        return {
            phase: 'deploy',
            status: 'awaitingApproval',
            resumeCommandId: copilotOnRailsCommandIds.openDeploymentPlanView,
            label: vscode.l10n.t('Deployment'),
        };
    }

    // Local development.
    if (debugPlanStatus !== undefined) {
        if (debugPlanStatus === 'implemented') {
            return {
                phase: 'localDev',
                status: 'completed',
                resumeCommandId: copilotOnRailsCommandIds.startDeployment,
                label: vscode.l10n.t('Local development complete'),
            };
        }
        return {
            phase: 'localDev',
            status: lastPhase === 'localDev' ? 'inProgress' : 'awaitingApproval',
            resumeCommandId: copilotOnRailsCommandIds.openLocalPlanView,
            label: vscode.l10n.t('Local development setup'),
        };
    }

    // Project creation: plan -> scaffold -> integrate.
    if (projectPlanStatus !== undefined) {
        const scaffolded = projectPlanStatus === 'scaffolded' || projectPlanStatus === 'ready';
        if (scaffolded) {
            if (lastPhase === 'integrate') {
                return {
                    phase: 'integrate',
                    status: 'inProgress',
                    resumeCommandId: copilotOnRailsCommandIds.startProjectIntegrate,
                    label: vscode.l10n.t('Integrating your project'),
                };
            }
            return {
                phase: 'scaffold',
                status: 'completed',
                resumeCommandId: copilotOnRailsCommandIds.startLocalDevelopment,
                label: vscode.l10n.t('Scaffolding complete'),
            };
        }
        // Plan exists but scaffolding hasn't finished.
        if (lastPhase === 'scaffold' || lastPhase === 'integrate') {
            return {
                phase: 'scaffold',
                status: 'inProgress',
                resumeCommandId: copilotOnRailsCommandIds.startProjectScaffold,
                resumeArgs: [SCAFFOLD_RESUME_PROMPT],
                label: vscode.l10n.t('Scaffolding your project'),
            };
        }
        return {
            phase: 'plan',
            status: 'awaitingApproval',
            resumeCommandId: copilotOnRailsCommandIds.openScaffoldPlanView,
            label: vscode.l10n.t('Project plan'),
        };
    }

    // Requirements gathering.
    if (hasRequirements) {
        return {
            phase: 'requirements',
            status: 'awaitingInput',
            resumeCommandId: copilotOnRailsCommandIds.openRequirementsView,
            label: vscode.l10n.t('Project requirements'),
        };
    }

    // No files yet, but a phase agent was launched in this workspace — the plan
    // agent is gathering requirements and hasn't written anything yet.
    if (lastPhase) {
        return {
            phase: lastPhase,
            status: 'inProgress',
            resumeCommandId: copilotOnRailsCommandIds.openRequirementsView,
            label: vscode.l10n.t('Project requirements'),
        };
    }

    return undefined;
}

/** True when the resume prompt has been dismissed for the given phase. */
export function isResumePromptDismissed(phase: FlowPhase): boolean {
    return ext.context.workspaceState.get<FlowPhase>(PROMPT_DISMISSED_PHASE_KEY) === phase;
}

/** Remembers that the user dismissed the resume prompt for the given phase. */
export async function dismissResumePrompt(phase: FlowPhase): Promise<void> {
    await ext.context.workspaceState.update(PROMPT_DISMISSED_PHASE_KEY, phase);
}

async function fileExists(glob: string): Promise<boolean> {
    const files = await vscode.workspace.findFiles(glob, undefined, 1);
    return files.length > 0;
}

/**
 * Reads the lowercased `Status:` value from a plan file, or `undefined` if the
 * file doesn't exist. Tolerates markdown decoration, e.g. `**Status**: _Scaffolded_`.
 */
async function readStatus(glob: string): Promise<string | undefined> {
    const files = await vscode.workspace.findFiles(glob, undefined, 1);
    if (!files.length) {
        return undefined;
    }
    let content: string;
    try {
        content = Buffer.from(await vscode.workspace.fs.readFile(files[0])).toString('utf-8');
    } catch {
        return undefined;
    }
    const match = content.match(/status[*_~]*\s*:\s*\*{0,2}_{0,2}([A-Za-z][A-Za-z ]*)/i);
    return match?.[1]?.trim().toLowerCase();
}
