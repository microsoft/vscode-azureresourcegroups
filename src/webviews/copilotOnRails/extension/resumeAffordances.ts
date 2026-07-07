/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getProjectPlanFiles, type ProjectPlanFilesWatcher } from '../../../tree/project/projectPlanFiles';
import { copilotOnRailsCommandIds } from './copilotOnRailsCommands';
import { clearSession, onDidChangeSession, phaseLabel, readSessionState, shouldOfferResume } from './projectSession';

let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Wires up the user-facing resume affordances for the create-with-copilot flow:
 *  - a status-bar item shown whenever an interrupted run is detected and hidden
 *    otherwise, so there is always a single, obvious way back into the correct
 *    phase instead of hunting through chat history;
 *  - a one-time, non-modal prompt on activation offering to resume.
 *
 * Both funnel into {@link copilotOnRailsCommandIds.resumeProjectWithCopilot}.
 */
export function registerResumeAffordances(context: vscode.ExtensionContext, planFilesWatcher: ProjectPlanFilesWatcher): void {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    statusBarItem.command = copilotOnRailsCommandIds.resumeProjectWithCopilot;
    context.subscriptions.push(statusBarItem);

    // The session record is the single source of truth, so re-evaluate whenever
    // it changes (a phase launched, or the session cleared).
    context.subscriptions.push(onDidChangeSession(() => updateStatusBar()));
    // When the workspace's project artifacts are created/deleted (e.g. the user
    // empties the workspace or removes the `.azure` folder), reconcile: a session
    // whose artifacts are all gone has nothing to resume, so clear it.
    context.subscriptions.push(planFilesWatcher.onDidChange(() => void reconcileAndUpdate()));

    void reconcileAndUpdate();
    void promptToResumeOnActivation();
}

async function reconcileAndUpdate(): Promise<void> {
    await clearSessionIfWorkspaceEmptied();
    updateStatusBar();
}

/** Clears the session when no project artifacts remain on disk to resume from. */
async function clearSessionIfWorkspaceEmptied(): Promise<void> {
    if (readSessionState() === undefined) {
        return;
    }
    // `hasAny` includes `.azure/requirements.json`, so an interrupted project
    // that only got as far as requirements is still resumable and won't be cleared.
    if (!(await getProjectPlanFiles()).hasAny) {
        await clearSession();
    }
}

function updateStatusBar(): void {
    if (!statusBarItem) {
        return;
    }
    const state = readSessionState();
    if (shouldOfferResume(state)) {
        statusBarItem.text = `$(debug-continue) ${vscode.l10n.t('Resume project setup')}`;
        statusBarItem.tooltip = vscode.l10n.t('Resume your in-progress Copilot project: {0}', phaseLabel(state.phase));
        statusBarItem.show();
    } else {
        statusBarItem.hide();
    }
}

async function promptToResumeOnActivation(): Promise<void> {
    // Reconcile first so an emptied workspace doesn't get prompted.
    await clearSessionIfWorkspaceEmptied();

    const state = readSessionState();
    if (!shouldOfferResume(state)) {
        return;
    }

    const resume = vscode.l10n.t('Resume');
    const notNow = vscode.l10n.t('Not now');
    const choice = await vscode.window.showInformationMessage(
        vscode.l10n.t('You have an in-progress Copilot project ({0}). Would you like to resume?', phaseLabel(state.phase)),
        resume,
        notNow,
    );

    if (choice === resume) {
        await vscode.commands.executeCommand(copilotOnRailsCommandIds.resumeProjectWithCopilot);
    } else if (choice === notNow) {
        // The user declined to resume — clear the record so we stop offering it.
        await clearSession();
    }
    // Dismissing the notification (no choice) leaves the record intact, so the
    // status-bar item remains available to resume later.
}
