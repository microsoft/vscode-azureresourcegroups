/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { openChatWithAgent } from '../../../commands/copilotOnRails/openChatWithAgent';
import { PROJECT_PLAN_FILE_GLOB } from '../../../tree/project/projectPlanFiles';
import { ProjectPlanStatus, statusEquals } from '../views/utils/projectPlanStatus';
import { openFrontendPreviewView } from './openFrontendPreviewView';
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
