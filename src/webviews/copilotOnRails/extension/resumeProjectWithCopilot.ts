/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { openChatWithAgent } from '../../../commands/copilotOnRails/openChatWithAgent';
import { DEBUG_PLAN_FILE_GLOB, PROJECT_PLAN_FILE_GLOB } from '../../../tree/project/projectPlanFiles';
import { CopilotOnRailsContext } from '../../../utils/copilotOnRails/CopilotOnRailsContext';
import { ProjectPlanStatus, statusEquals } from '../views/utils/projectPlanStatus';
import { type LoadingViewConfiguration } from '../views/utils/viewConfigTypes';
import { isDebugPlanImplemented } from './autopilot';
import { openFrontendPreviewView } from './openFrontendPreviewView';
import { openLocalDevNextStepsView } from './openLocalDevNextStepsView';
import { openScaffoldNextStepsView } from './openScaffoldNextStepsView';
import { buildResumePrompt, markSessionActiveInWindow, type ProjectPhase, readSessionState, resumeAgentFor } from './projectSession';
import { readProjectPlanStatus } from './utils/planStatus';

/**
 * The loading view shown when resuming a phase by re-launching its chat agent,
 * so the user gets the same "Copilot is working" surface as the original launch
 * instead of a bare chat with no visible progress. Mirrors the loading configs
 * of the `start*` hand-off commands (stage: 0 = scaffolding, 1 = local dev,
 * 2 = deployment).
 */
const RESUME_LOADING: Readonly<Record<ProjectPhase, LoadingViewConfiguration>> = {
    plan: { stage: 0, title: vscode.l10n.t('Resuming project planning...'), message: vscode.l10n.t('Copilot is picking your project plan back up where it left off.'), showNeedHelp: true },
    scaffold: { stage: 0, title: vscode.l10n.t('Resuming scaffolding...'), message: vscode.l10n.t('Copilot is picking your project scaffolding back up where it left off.'), showNeedHelp: true },
    integrate: { stage: 0, title: vscode.l10n.t('Resuming integration...'), message: vscode.l10n.t('Copilot is picking your live-data integration back up where it left off.'), showNeedHelp: true },
    localDev: { stage: 1, title: vscode.l10n.t('Resuming local development...'), message: vscode.l10n.t('Copilot is picking your local development setup back up where it left off.'), showNeedHelp: true },
    deploy: { stage: 2, title: vscode.l10n.t('Resuming deployment...'), message: vscode.l10n.t('Copilot is picking your deployment back up where it left off.'), showNeedHelp: true },
};

/**
 * Resumes an interrupted "Create with Copilot" run. Reads the single
 * extension-owned session record and re-opens the phase's chat agent in a fresh
 * session seeded with a "continue, don't restart" prompt that references the
 * phase's `.azure/*` artifacts.
 *
 * A fresh session (rather than reopening the original chat) is used deliberately:
 * VS Code exposes no stable API to reference or rehydrate a prior chat session by
 * id, so the reliable equivalent is a new session seeded with the relevant
 * context — which {@link openChatWithAgent} provides via the query.
 */
export async function resumeProjectWithCopilot(context: CopilotOnRailsContext): Promise<void> {
    const state = readSessionState();
    if (!state) {
        void vscode.window.showInformationMessage(
            vscode.l10n.t('No in-progress Copilot project was found to resume.'),
        );
        return;
    }

    // Resuming re-engages the flow in this window, so mark the session active up
    // front — the resume offer should be dismissed even on paths below that
    // re-open a view instead of launching a new chat agent.
    markSessionActiveInWindow();

    // Scaffolding finished at the UI-approval gate: the project is "Awaiting
    // Integration" but the user hasn't approved the UI yet (its "Approve UI"
    // button is what hands off to the integrate agent). Re-open the Frontend
    // Preview so they can approve, rather than resuming a chat session.
    if (state.phase === 'scaffold' && await isAwaitingIntegration()) {
        await openFrontendPreviewView(context);
        return;
    }

    // Integration finished: the integrate agent advanced the project plan to
    // "Integrated" and opened the post-integration "next steps" view (set up
    // local development / deploy). Re-open that view rather than resuming the
    // integrate chat, which already completed its work.
    if (state.phase === 'integrate' && await isIntegrationComplete()) {
        openScaffoldNextStepsView(context);
        return;
    }

    // Local development finished at debug-config generation: the debug plan is
    // "Implemented" and the flow's next surface is the local-dev "next steps"
    // view (deploy / iterate / run API tests) that the debug-generate agent opens
    // on completion — not another debug-plan chat. Re-open that view instead.
    if (state.phase === 'localDev' && await isDebugConfigImplemented()) {
        await openLocalDevNextStepsView(context);
        return;
    }

    await openChatWithAgent(context, resumeAgentFor(state.phase), buildResumePrompt(state), RESUME_LOADING[state.phase]);
}

/**
 * True when `.azure/project-plan.md` reports the `Awaiting Integration` status —
 * the point at which the scaffold agent has finished and opened the frontend
 * UI-approval gate, but the hand-off to integration has not yet happened.
 */
async function isAwaitingIntegration(): Promise<boolean> {
    return statusEquals(await readProjectPlanStatus(PROJECT_PLAN_FILE_GLOB), ProjectPlanStatus.awaitingIntegration);
}

/**
 * True when `.azure/project-plan.md` reports the `Integrated` status — the point
 * at which the integrate agent has finished wiring the frontend to live data and
 * opened the post-integration "next steps" view.
 */
async function isIntegrationComplete(): Promise<boolean> {
    return statusEquals(await readProjectPlanStatus(PROJECT_PLAN_FILE_GLOB), ProjectPlanStatus.integrated);
}

/**
 * True when `.azure/vscode-debug-plan.md` reports the `Implemented` status — the
 * point at which debug-config generation has finished. Uses the same detector as
 * the autopilot completion watcher so resume agrees with how completion is
 * signalled everywhere else.
 */
async function isDebugConfigImplemented(): Promise<boolean> {
    const [uri] = await vscode.workspace.findFiles(DEBUG_PLAN_FILE_GLOB, undefined, 1);
    if (!uri) {
        return false;
    }
    try {
        const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
        return isDebugPlanImplemented(content);
    } catch {
        return false;
    }
}
