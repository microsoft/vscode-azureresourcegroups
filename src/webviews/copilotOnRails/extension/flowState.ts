/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { copilotOnRailsCommandIds } from './copilotOnRailsCommands';
import { DEBUG_PLAN_GLOB, DEPLOYMENT_PLAN_GLOB, PROJECT_PLAN_GLOB, REQUIREMENTS_GLOB } from './planFilePaths';
import { isAnyFlowViewOpen } from './utils/singletonViewHost';

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

/**
 * Prompt used when resuming an interrupted integration. Scaffolding is already
 * finished; `.azure/integration-plan.md` describes the remaining live-data
 * wiring and the plan sits at `Integrating` (where an interrupted run is
 * expected to stop). The agent must continue that work rather than re-scaffold
 * or restart integration from scratch.
 */
const INTEGRATE_RESUME_PROMPT = 'Resume integrating this project. The scaffold is complete and `.azure/integration-plan.md` describes the remaining work; the plan status is `Integrating` (an interrupted integration is expected to sit here). Do NOT re-scaffold or restart integration from scratch. Read the integration plan and the current state of the code, then continue from where it left off: finish the schema migrations, wire the frontend to live data (removing the mocks), and run the frontend + backend together end-to-end.';

/**
 * Builds the prompt for resuming an interrupted local-development setup. The
 * debug plan already exists, so the agent must continue from its current status
 * rather than start over — the status is interpolated so the prompt tells the
 * agent exactly how far along the run is (e.g. approved and mid-generation vs.
 * still awaiting approval).
 */
function localDevResumePrompt(debugPlanStatus: string | undefined): string {
    const statusClause = debugPlanStatus ? ` Its current status is \`${debugPlanStatus}\`.` : '';
    return `Resume setting up local development. A debug plan already exists at \`.azure/vscode-debug-plan.md\`.${statusClause} Do NOT start over. Read the existing plan and continue from where it left off: if it still needs the user's approval, present it; if it is approved or partly generated, continue generating and validating the F5 debug configuration until it runs cleanly, then mark the plan \`Implemented\`.`;
}


/** Maps a launched agent name to the flow phase it advances. */
const AGENT_PHASE: Readonly<Record<string, FlowPhase>> = {
    'azure-project-plan': 'plan',
    'azure-project-scaffold': 'scaffold',
    'azure-project-integrate': 'integrate',
    'azure-debug-plan': 'localDev',
    'azure-debug-generate': 'localDev',
    'azure-deploy': 'deploy',
};

/**
 * In-memory marker: set once any flow phase is launched in THIS window, and
 * deliberately NOT persisted. A window reload — the main way a run gets
 * interrupted — clears it.
 */
let flowSessionActiveInWindow = false;

const onDidChangeFlowStateEmitter = new vscode.EventEmitter<void>();
/**
 * Fires when the in-memory flow session state changes (e.g. a phase agent was
 * just launched). The progress tree listens to this so the Resume affordance
 * disappears immediately once a resume/launch makes the session active, instead
 * of lingering until the next unrelated refresh.
 */
export const onDidChangeFlowState = onDidChangeFlowStateEmitter.event;

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
    flowSessionActiveInWindow = true;
    const state = ext.context.workspaceState;
    await state.update(LAST_PHASE_KEY, phase);
    // A new phase started — re-enable the resume prompt for it.
    if (state.get<FlowPhase>(PROMPT_DISMISSED_PHASE_KEY) !== phase) {
        await state.update(PROMPT_DISMISSED_PHASE_KEY, undefined);
    }
    // The session is now active, so any Resume affordance should retire — tell
    // listeners (the progress tree) to re-resolve immediately.
    onDidChangeFlowStateEmitter.fire();
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
        readPlanStatus(PROJECT_PLAN_GLOB),
        readPlanStatus(DEBUG_PLAN_GLOB),
        fileExists(DEPLOYMENT_PLAN_GLOB),
    ]);

    // An empty workspace (no `.azure/*` artifacts on disk) has nothing to
    // resume. A `lastPhase` left over in workspaceState would otherwise
    // resurrect a phantom session via the requirements fallback rule, so wipe
    // all cached session state and report no flow.
    const hasAnyArtifact = hasRequirements || projectPlanStatus !== undefined || debugPlanStatus !== undefined || hasDeploymentPlan;
    if (!hasAnyArtifact) {
        await clearFlowSession();
        return undefined;
    }

    const lastPhase = ext.context.workspaceState.get<FlowPhase>(LAST_PHASE_KEY);

    return computeFlowState({ hasRequirements, projectPlanStatus, debugPlanStatus, hasDeploymentPlan, lastPhase });
}

/**
 * Wipes all cached flow-session state: the in-memory active-window flag and the
 * persisted last-phase / prompt-dismissal keys. Invoked when the workspace has
 * no `.azure/*` artifacts, so a stale cache can never resurrect a phantom
 * session. Fires {@link onDidChangeFlowState} only when something actually
 * changed, so repeated resolves on an empty workspace don't loop the tree.
 */
async function clearFlowSession(): Promise<void> {
    let changed = flowSessionActiveInWindow;
    flowSessionActiveInWindow = false;

    const state = ext.context.workspaceState;
    if (state.get<FlowPhase>(LAST_PHASE_KEY) !== undefined) {
        await state.update(LAST_PHASE_KEY, undefined);
        changed = true;
    }
    if (state.get<FlowPhase>(PROMPT_DISMISSED_PHASE_KEY) !== undefined) {
        await state.update(PROMPT_DISMISSED_PHASE_KEY, undefined);
        changed = true;
    }

    if (changed) {
        onDidChangeFlowStateEmitter.fire();
    }
}

/** True while a create-with-copilot phase is being driven in this window. */
export function isFlowSessionActive(): boolean {
    return flowSessionActiveInWindow;
}

export function shouldOfferResume(flow: FlowState | undefined): flow is FlowState {
    return !!flow && flow.status !== 'completed' && !isAnyFlowViewOpen() && !isFlowSessionActive();
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
 * Raw, lowercased `Status:` values the agents write into the plan files.
 * Centralized so the decision table never hard-codes a magic string.
 */
export const PLAN_STATUS = {
    /** project-plan.md: plan being drafted, not yet approved. */
    planning: 'planning',
    /** project-plan.md / vscode-debug-plan.md: approved, work not yet finished. */
    approved: 'approved',
    /** project-plan.md: scaffolding is underway (set when the scaffold agent is launched). */
    inProgress: 'in progress',
    /** project-plan.md: scaffold done, frontend preview shown, awaiting the user's UI sign-off. */
    awaitingUxApproval: 'awaiting ux approval',
    /** project-plan.md: UI approved (or no frontend), live-data integration not yet started. */
    awaitingIntegration: 'awaiting integration',
    /** project-plan.md: live-data integration underway — resume continues it. */
    integrating: 'integrating',
    /** project-plan.md: scaffold + integration both complete. */
    integrated: 'integrated',
    /** project-plan.md: legacy aliases still treated as fully scaffolded. */
    scaffolded: 'scaffolded',
    ready: 'ready',
    /** vscode-debug-plan.md: local-dev configuration implemented. */
    implemented: 'implemented',
} as const;

/**
 * project-plan.md statuses meaning scaffolding has finished. The plan's Status
 * field advances Planning → Approved → In Progress → Awaiting UX Approval →
 * Awaiting Integration → Integrating → Integrated; `scaffolded`/`ready` are
 * legacy aliases.
 */
const SCAFFOLD_COMPLETE_STATUSES: readonly string[] = [
    PLAN_STATUS.awaitingUxApproval,
    PLAN_STATUS.awaitingIntegration,
    PLAN_STATUS.integrating,
    PLAN_STATUS.integrated,
    PLAN_STATUS.scaffolded,
    PLAN_STATUS.ready,
];

/** True when the project plan reports scaffolding as finished. */
function isScaffoldComplete(projectPlanStatus: string | undefined): boolean {
    return projectPlanStatus !== undefined && SCAFFOLD_COMPLETE_STATUSES.includes(projectPlanStatus);
}

/**
 * project-plan.md statuses meaning the whole project-creation stage is finished
 * (scaffold + live-data integration both done). Unlike
 * {@link SCAFFOLD_COMPLETE_STATUSES} this excludes `Awaiting Integration`, where
 * the scaffold is built but integration is still pending.
 */
const PROJECT_CREATION_COMPLETE_STATUSES: readonly string[] = [
    PLAN_STATUS.integrated,
    PLAN_STATUS.scaffolded,
    PLAN_STATUS.ready,
];

/**
 * True once the project-creation stage is fully finished, i.e. the project has
 * been integrated (or, via the legacy aliases, fully scaffolded). Distinct from
 * {@link isScaffoldComplete}, which also returns true for `Awaiting Integration`.
 */
export function isProjectCreationComplete(projectPlanStatus: string | undefined): boolean {
    return projectPlanStatus !== undefined && PROJECT_CREATION_COMPLETE_STATUSES.includes(projectPlanStatus);
}

/**
 * True once the user has approved the scaffolded frontend UI. The plan sits at
 * `Awaiting UX Approval` until the preview's Approve action advances it, so any
 * scaffold-complete status other than `Awaiting UX Approval` means the UI has
 * already been signed off — used to keep the preview's Approve button disabled
 * when the view is reopened after approval.
 */
export function isFrontendApproved(projectPlanStatus: string | undefined): boolean {
    return isScaffoldComplete(projectPlanStatus) && projectPlanStatus !== PLAN_STATUS.awaitingUxApproval;
}

/** A single ordered rule in the flow-state decision table. */
interface FlowRule {
    /** Whether this rule matches the observed signals. */
    matches: (signals: FlowSignals) => boolean;
    /** Builds the resumable flow state for a matched rule. */
    build: (signals: FlowSignals) => FlowState;
}

/**
 * Ordered decision table mapping observed signals to a resumable flow state.
 * Evaluated top-to-bottom by {@link computeFlowState}; the first matching rule
 * wins. Ordering encodes phase precedence — a later-stage artifact (deployment
 * plan) outranks earlier ones, so a stale cache can never drag the user
 * backwards.
 */
const FLOW_RULES: readonly FlowRule[] = [
    // Deployment is the last stage.
    {
        matches: (s) => s.hasDeploymentPlan,
        build: () => ({
            phase: 'deploy',
            status: 'awaitingApproval',
            resumeCommandId: copilotOnRailsCommandIds.openDeploymentPlanView,
            label: vscode.l10n.t('Deployment'),
        }),
    },
    // Local development complete → surface the next-steps view (which offers
    // deployment) rather than jumping straight into the deploy agent, so the
    // user lands on the same "what's next?" summary the debug agent shows.
    {
        matches: (s) => s.debugPlanStatus === PLAN_STATUS.implemented,
        build: () => ({
            phase: 'localDev',
            status: 'completed',
            resumeCommandId: copilotOnRailsCommandIds.openLocalNextStepsView,
            label: vscode.l10n.t('Local development complete'),
        }),
    },
    // Local development plan exists but is not yet implemented. If the debug
    // agent was running in this window (lastPhase === localDev), the run was
    // interrupted mid-flight — relaunch it with a status-aware "continue" prompt
    // so it resumes from where it left off instead of restarting. Otherwise the
    // plan is merely awaiting the user's approval, so reopen the approval view.
    {
        matches: (s) => s.debugPlanStatus !== undefined,
        build: (s) => s.lastPhase === 'localDev'
            ? {
                phase: 'localDev',
                status: 'inProgress',
                resumeCommandId: copilotOnRailsCommandIds.startLocalDevelopment,
                resumeArgs: [localDevResumePrompt(s.debugPlanStatus)],
                label: vscode.l10n.t('Local development setup'),
            }
            : {
                phase: 'localDev',
                status: 'awaitingApproval',
                resumeCommandId: copilotOnRailsCommandIds.openLocalPlanView,
                label: vscode.l10n.t('Local development setup'),
            },
    },
    // Scaffold finished and produced a frontend preview that is still awaiting
    // the user's UI sign-off → resume by reopening the preview/approval gate.
    // Never relaunch the scaffold agent: the frontend is already built.
    {
        matches: (s) => s.projectPlanStatus === PLAN_STATUS.awaitingUxApproval,
        build: () => ({
            phase: 'integrate',
            status: 'awaitingApproval',
            resumeCommandId: copilotOnRailsCommandIds.openFrontendPreviewView,
            label: vscode.l10n.t('Review your app preview'),
        }),
    },
    // Never relaunch the scaffold agent here: it would
    // re-open the frontend preview before the (already-built) frontend is
    // re-scaffolded.
    {
        matches: (s) =>
            s.projectPlanStatus === PLAN_STATUS.awaitingIntegration ||
            s.projectPlanStatus === PLAN_STATUS.integrating ||
            // Legacy aliases (`scaffolded`/`ready`) have no explicit integration
            // state, so a cached `integrate` launch is the only signal that
            // integration was underway. `integrated` is excluded: it is the
            // terminal "integration done" state, so it must fall through to the
            // scaffold-complete rule below rather than re-offer a resume.
            (isScaffoldComplete(s.projectPlanStatus) && s.projectPlanStatus !== PLAN_STATUS.integrated && s.lastPhase === 'integrate'),
        build: (s) => {
            // "Awaiting Integration" with no integrate launch yet is a fresh
            // hand-off (scaffold done, integration not started) — use the
            // command's default first-run prompt. Any other match is an
            // interrupted, in-flight integration that must continue, not restart.
            const isFreshHandoff = s.projectPlanStatus === PLAN_STATUS.awaitingIntegration && s.lastPhase !== 'integrate';
            return {
                phase: 'integrate',
                status: isFreshHandoff ? 'awaitingApproval' : 'inProgress',
                resumeCommandId: copilotOnRailsCommandIds.startProjectIntegrate,
                resumeArgs: isFreshHandoff ? undefined : [INTEGRATE_RESUME_PROMPT],
                label: vscode.l10n.t('Integrating your project'),
            };
        },
    },
    // Scaffold + integration complete → local development next.
    {
        matches: (s) => isScaffoldComplete(s.projectPlanStatus),
        build: () => ({
            phase: 'scaffold',
            status: 'completed',
            resumeCommandId: copilotOnRailsCommandIds.startLocalDevelopment,
            label: vscode.l10n.t('Scaffolding complete'),
        }),
    },
    // Plan exists but scaffolding hasn't finished → an interrupted scaffold to
    // resume. The plan's own `In Progress` status is the deterministic signal
    // (written by the launch command, not the agent); the cached `lastPhase` is
    // only a fallback for the window where the status write hasn't landed yet.
    {
        matches: (s) => s.projectPlanStatus !== undefined &&
            (s.projectPlanStatus === PLAN_STATUS.inProgress || s.lastPhase === 'scaffold' || s.lastPhase === 'integrate'),
        build: () => ({
            phase: 'scaffold',
            status: 'inProgress',
            resumeCommandId: copilotOnRailsCommandIds.startProjectScaffold,
            resumeArgs: [SCAFFOLD_RESUME_PROMPT],
            label: vscode.l10n.t('Scaffolding your project'),
        }),
    },
    // Plan exists and is still awaiting approval.
    {
        matches: (s) => s.projectPlanStatus !== undefined,
        build: () => ({
            phase: 'plan',
            status: 'awaitingApproval',
            resumeCommandId: copilotOnRailsCommandIds.openScaffoldPlanView,
            label: vscode.l10n.t('Project plan'),
        }),
    },
    // Requirements gathered, no plan yet.
    {
        matches: (s) => s.hasRequirements,
        build: () => ({
            phase: 'requirements',
            status: 'awaitingInput',
            resumeCommandId: copilotOnRailsCommandIds.openRequirementsView,
            label: vscode.l10n.t('Project requirements'),
        }),
    },
    // No files yet, but a phase agent was launched in this workspace — the plan
    // agent is gathering requirements and hasn't written anything yet.
    {
        matches: (s) => s.lastPhase !== undefined,
        build: (s) => ({
            phase: s.lastPhase as FlowPhase,
            status: 'inProgress',
            resumeCommandId: copilotOnRailsCommandIds.openRequirementsView,
            label: vscode.l10n.t('Project requirements'),
        }),
    },
];

/**
 * Pure decision logic mapping the observed signals to a resumable flow state by
 * walking {@link FLOW_RULES} in order and returning the first match. Returns
 * `undefined` when no flow has been started.
 */
export function computeFlowState(signals: FlowSignals): FlowState | undefined {
    return FLOW_RULES.find((rule) => rule.matches(signals))?.build(signals);
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
 * Matches the first `Status:` line in a plan file. Anchored to a line start
 * (`m` flag) so it can't be fooled by an incidental "status:" elsewhere in the
 * document, and tolerant of markdown decoration on the label (e.g.
 * `**Status**:`). Capture group 1 is the label + separator (preserved by
 * {@link writePlanStatus}); group 2 is the raw value up to end of line.
 */
const STATUS_LINE_REGEX = /^([ \t]*\*{0,2}status\*{0,2}[ \t]*:[ \t]*)([^\r\n]*)/im;

/**
 * Reads the lowercased `Status:` value from a plan file, or `undefined` if the
 * file doesn't exist. Tolerates markdown decoration, e.g. `**Status**: _Scaffolded_`.
 */
export async function readPlanStatus(glob: string): Promise<string | undefined> {
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
    const line = content.match(STATUS_LINE_REGEX);
    // Group 2 is the raw value (possibly decorated, e.g. `_Scaffolded_` or a
    // `Planning | Approved | …` template list); take its leading status word(s),
    // dropping surrounding `*`/`_` decoration and anything past the first word.
    const value = line?.[2]?.match(/[A-Za-z][A-Za-z ]*/);
    return value?.[0]?.trim().toLowerCase();
}

/**
 * Overwrites the `Status:` value of a plan file, preserving the label and any
 * markdown decoration on it (e.g. `**Status**:`). Used to make state
 * transitions that must be immediate and reliable in extension code rather than
 * leaving them to a chat agent. Returns `true` if the file was updated.
 */
export async function writePlanStatus(glob: string, newStatus: string): Promise<boolean> {
    const files = await vscode.workspace.findFiles(glob, undefined, 1);
    if (!files.length) {
        return false;
    }
    const uri = files[0];
    let content: string;
    try {
        content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
    } catch {
        return false;
    }
    // Replace only the value on the first `Status:` line, keeping the label
    // (and any `**`/`_` decoration around it) exactly as authored.
    if (!STATUS_LINE_REGEX.test(content)) {
        return false;
    }
    const updated = content.replace(STATUS_LINE_REGEX, (_full, prefix: string) => `${prefix}${newStatus}`);
    if (updated === content) {
        return false;
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, 'utf-8'));
    return true;
}

/**
 * Advances a plan file's `Status:` to `newStatus`, but only when its current
 * status is one of `from`. The guard makes every transition idempotent and
 * one-directional: it never regresses a later status or clobbers an unrelated
 * phase, so callers can fire it on a deterministic UI signal without first
 * re-checking where the plan is. Returns `true` if the file was updated.
 */
async function advancePlanStatus(glob: string, from: readonly string[], newStatus: string): Promise<boolean> {
    const status = await readPlanStatus(glob);
    if (status !== undefined && from.includes(status)) {
        return writePlanStatus(glob, newStatus);
    }
    return false;
}

/**
 * Marks the project plan `Integrated` when advancing to local development. The
 * integrate agent is supposed to write this itself at the end of its run, but
 * it isn't guaranteed to; opening the next step is the deterministic signal that
 * integration is done, so finalize the status here. Only advances from the
 * in-flight integration states so it never clobbers an earlier phase.
 */
export async function markProjectPlanIntegrated(): Promise<void> {
    await advancePlanStatus(PROJECT_PLAN_GLOB, [PLAN_STATUS.awaitingIntegration, PLAN_STATUS.integrating], 'Integrated');
}

/**
 * Marks the project plan `In Progress` when the scaffold agent is launched. The
 * launch command owns this transition (rather than the agent) so scaffolding is
 * detectable as in-flight the moment it starts — this is the load-bearing signal
 * an interrupted-scaffold resume relies on. Only advances from the pre-scaffold
 * states so it never regresses a plan that is already scaffolding or further.
 */
export async function markProjectScaffolding(): Promise<void> {
    await advancePlanStatus(PROJECT_PLAN_GLOB, [PLAN_STATUS.planning, PLAN_STATUS.approved], 'In Progress');
}

/**
 * Marks the project plan `Awaiting UX Approval` when the frontend preview gate
 * is opened at the end of scaffolding. Opening the preview is the deterministic
 * signal that the scaffold produced a frontend awaiting the user's sign-off, so
 * the launch command owns this transition rather than the agent. Only advances
 * from `In Progress` so reopening the preview after approval never regresses a
 * later status.
 */
export async function markFrontendAwaitingUxApproval(): Promise<void> {
    await advancePlanStatus(PROJECT_PLAN_GLOB, [PLAN_STATUS.inProgress], 'Awaiting UX Approval');
}

/**
 * Marks the project plan `Integrating` when the integrate step is launched. The
 * command that starts integration owns this transition (rather than the agent),
 * so the state advances deterministically the moment integration begins. Accepts
 * every post-scaffold, pre-integrated state — including `In Progress`, the state
 * of a no-frontend / autopilot run that skips the UI-approval gate — so it never
 * regresses an already-`Integrated` plan that is being re-verified.
 */
export async function markProjectIntegrating(): Promise<void> {
    await advancePlanStatus(
        PROJECT_PLAN_GLOB,
        [
            PLAN_STATUS.inProgress,
            PLAN_STATUS.awaitingUxApproval,
            PLAN_STATUS.awaitingIntegration,
            PLAN_STATUS.integrating,
        ],
        'Integrating',
    );
}
