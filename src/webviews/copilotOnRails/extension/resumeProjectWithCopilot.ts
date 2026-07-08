/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { openChatWithAgent } from '../../../commands/copilotOnRails/openChatWithAgent';
import { DEBUG_PLAN_FILE_GLOB, PROJECT_PLAN_FILE_GLOB } from '../../../tree/project/projectPlanFiles';
import { ProjectPlanStatus, statusEquals } from '../views/utils/projectPlanStatus';
import { isDebugPlanImplemented } from './autopilot';
import { openFrontendPreviewView } from './openFrontendPreviewView';
import { openLocalDevNextStepsView } from './openLocalDevNextStepsView';
import { buildResumePrompt, markSessionActiveInWindow, readSessionState, resumeAgentFor } from './projectSession';
import { readProjectPlanStatus } from './utils/planStatus';

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
export async function resumeProjectWithCopilot(_context: IActionContext): Promise<void> {
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
        await openFrontendPreviewView();
        return;
    }

    // Local development finished at debug-config generation: the debug plan is
    // "Implemented" and the flow's next surface is the local-dev "next steps"
    // view (deploy / iterate / run API tests) that the debug-generate agent opens
    // on completion — not another debug-plan chat. Re-open that view instead.
    if (state.phase === 'localDev' && await isDebugConfigImplemented()) {
        await openLocalDevNextStepsView();
        return;
    }

    await openChatWithAgent(resumeAgentFor(state.phase), buildResumePrompt(state));
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
