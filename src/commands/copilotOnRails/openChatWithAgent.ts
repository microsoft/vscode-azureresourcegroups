/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { projectSubmissionState } from '../../tree/project/projectSubmissionState';
import { openLoadingView } from '../../webviews/copilotOnRails/extension/openLoadingView';
import { recordAgentLaunch } from '../../webviews/copilotOnRails/extension/projectSession';
import { type LoadingViewConfiguration } from '../../webviews/copilotOnRails/views/utils/viewConfigTypes';
import { recordDiagnosticEvent } from '../../utils/copilotOnRails/copilotOnRailsDiagnosticUtils';
import { phaseForEventName } from '../../utils/copilotOnRails/copilotOnRailsPhaseReport';
import { ensureAgentInstructions } from './agentInstructions';

const COPILOT_CHAT_EXTENSION_ID = 'GitHub.copilot-chat';

/**
 * Ensure the GitHub Copilot Chat extension is installed and activated before invoking
 * `workbench.action.chat.open`. Custom chat agents contributed via `package.json`
 * (`chatAgents`) are not registered until that extension activates, so opening chat
 * with a `mode` referring to one of them silently no-ops if we don't wait.
 */
export async function ensureCopilotChatReady(): Promise<boolean> {
    const ext = vscode.extensions.getExtension(COPILOT_CHAT_EXTENSION_ID);
    if (!ext) {
        void vscode.window.showErrorMessage(
            vscode.l10n.t('GitHub Copilot Chat is required to continue. Please install the GitHub Copilot Chat extension and try again.'),
        );
        return false;
    }
    if (!ext.isActive) {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Starting GitHub Copilot Chat...') },
            async () => { await ext.activate(); },
        );
    }
    return true;
}

/**
 * A fresh session is started for each phase hand-off because agents communicate
 * through the `.azure/*` plan files on disk, not chat history, so a clean session
 * keeps each agent's context window focused on its own phase instead of
 * accumulating the entire plan → scaffold → debug conversation.
 */
export async function launchAgentChat(agentName: string, query: string): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.chat.newChat');
    await vscode.commands.executeCommand('workbench.action.chat.open', {
        mode: agentName,
        query,
    });
    // Record the phase we just launched so an interrupted run can be resumed.
    await recordAgentLaunch(agentName);

    // A phase's real work happens inside the handed-off agent, which isn't
    // otherwise instrumented, and several entry paths (webview plan-approval,
    // resume) launch agents directly without a `start_*` command. Record a
    // phase-boundary diagnostic event keyed by the agent name so every phase
    // shows up in the phase-duration report regardless of how it was entered.
    if (phaseForEventName(agentName)) {
        recordDiagnosticEvent({ name: agentName, type: 'extensionCommand', status: 'start', properties: { agentLaunch: true } });
    }
}

export async function openChatWithAgent(agentName: string, prompt: string, loading?: LoadingViewConfiguration): Promise<void> {
    if (!(await ensureCopilotChatReady())) {
        return;
    }
    // Make sure the agent's instruction files are present in the workspace before invoking it.
    if (!(await ensureAgentInstructions(agentName))) {
        return;
    }
    await launchAgentChat(agentName, prompt);

    if (loading) {
        projectSubmissionState.setPending(loading.stage);
        openLoadingView(loading);
    }
}
