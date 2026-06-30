/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { projectSubmissionState } from '../../tree/project/projectSubmissionState';
import { openLoadingView } from '../../webviews/copilotOnRails/extension/openLoadingView';
import { type LoadingViewConfiguration } from '../../webviews/copilotOnRails/views/utils/viewConfigTypes';
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

export async function openChatWithAgent(agentName: string, prompt: string, loading?: LoadingViewConfiguration): Promise<void> {
    if (!(await ensureCopilotChatReady())) {
        return;
    }
    // Make sure the agent's instruction files are present in the workspace before invoking it.
    if (!(await ensureAgentInstructions(agentName))) {
        return;
    }
    // Start a fresh chat session for each phase hand-off. Agents communicate through the
    // `.azure/*.md` plan files on disk, not chat history, so a clean session keeps each
    // agent's context window focused on its own phase instead of accumulating the entire
    // plan → scaffold → debug conversation.
    await vscode.commands.executeCommand('workbench.action.chat.newChat');
    await vscode.commands.executeCommand('workbench.action.chat.open', {
        mode: agentName,
        query: prompt,
    });

    if (loading) {
        projectSubmissionState.setPending(loading.stage);
        openLoadingView(loading);
    }
}
