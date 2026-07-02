/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type ProjectPlanFilesWatcher } from '../../../tree/project/projectPlanFiles';
import { copilotOnRailsCommandIds } from './copilotOnRailsCommands';
import { dismissResumePrompt, isResumePromptDismissed, resolveFlowState, shouldOfferResume } from './flowState';
import { onDidChangeFlowViewState } from './utils/singletonViewHost';

let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Wires up the user-facing resume affordances for the create-with-copilot flow:
 *  - a status-bar item that is shown whenever an interrupted run is detected and
 *    hidden otherwise, so there is always a single, obvious way back into the
 *    correct phase instead of hunting through chat history;
 *  - a one-time, non-modal prompt on activation offering to resume.
 *
 * Both funnel into {@link copilotOnRailsCommandIds.resumeProjectWithCopilot}.
 */
export function registerResumeAffordances(context: vscode.ExtensionContext, planFilesWatcher: ProjectPlanFilesWatcher): void {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    statusBarItem.command = copilotOnRailsCommandIds.resumeProjectWithCopilot;
    context.subscriptions.push(statusBarItem);

    context.subscriptions.push(planFilesWatcher.onDidChange(() => void updateStatusBar()));
    // A flow view opening or closing changes whether the user needs a way *back*
    // into the flow, so re-evaluate the status bar when that happens.
    context.subscriptions.push(onDidChangeFlowViewState(() => void updateStatusBar()));

    void updateStatusBar();
    void promptToResumeOnActivation();
}

async function updateStatusBar(): Promise<void> {
    if (!statusBarItem) {
        return;
    }
    // Only offer to resume when an incomplete flow has no view currently driving
    // it and no chat session is running it in this window — if the flow is being
    // driven right now, there is nothing to "resume".
    const flow = await resolveFlowState();
    if (shouldOfferResume(flow)) {
        statusBarItem.text = `$(debug-continue) ${vscode.l10n.t('Resume project setup')}`;
        statusBarItem.tooltip = vscode.l10n.t('Resume your in-progress Copilot project: {0}', flow.label);
        statusBarItem.show();
    } else {
        statusBarItem.hide();
    }
}

async function promptToResumeOnActivation(): Promise<void> {
    const flow = await resolveFlowState();
    if (!shouldOfferResume(flow) || isResumePromptDismissed(flow.phase)) {
        return;
    }

    const resume = vscode.l10n.t('Resume');
    const notNow = vscode.l10n.t('Not now');
    const choice = await vscode.window.showInformationMessage(
        vscode.l10n.t('You have an in-progress Copilot project ({0}). Would you like to resume?', flow.label),
        resume,
        notNow,
    );

    if (choice === resume) {
        await vscode.commands.executeCommand(copilotOnRailsCommandIds.resumeProjectWithCopilot);
    } else if (choice === notNow) {
        await dismissResumePrompt(flow.phase);
    }
}
