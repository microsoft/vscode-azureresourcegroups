/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { projectSubmissionState } from '../../tree/project/projectSubmissionState';
import { openLoadingView } from '../../webviews/copilotOnRails/extension/openLoadingView';
import { recordAgentLaunch } from '../../webviews/copilotOnRails/extension/projectSession';
import { type LoadingViewConfiguration } from '../../webviews/copilotOnRails/views/utils/viewConfigTypes';
import { ensureAgentInstructions } from './agentInstructions';

const COPILOT_CHAT_EXTENSION_ID = 'GitHub.copilot-chat';
const CUSTOM_AGENT_COMMAND_PREFIX = 'workbench.action.chat.open';
const CUSTOM_AGENT_LOAD_TIMEOUT_MS = 10_000;
const CUSTOM_AGENT_LOAD_POLL_INTERVAL_MS = 100;
let agentLaunchInProgress = false;

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
async function waitForCustomAgentCommand(agentName: string): Promise<string | undefined> {
    const commandId = `${CUSTOM_AGENT_COMMAND_PREFIX}${agentName}`;
    const deadline = Date.now() + CUSTOM_AGENT_LOAD_TIMEOUT_MS;

    do {
        if ((await vscode.commands.getCommands()).includes(commandId)) {
            return commandId;
        }
        await new Promise(resolve => setTimeout(resolve, CUSTOM_AGENT_LOAD_POLL_INTERVAL_MS));
    } while (Date.now() < deadline);

    return undefined;
}

export async function launchAgentChat(agentName: string, query: string): Promise<boolean> {
    if (agentLaunchInProgress) {
        void vscode.window.showWarningMessage(
            vscode.l10n.t('Another Copilot agent is still starting. Please wait and try again.'),
        );
        return false;
    }

    agentLaunchInProgress = true;
    try {
        // Revealing chat initializes its custom-mode registry. The agent-specific
        // command appears only after VS Code has finished loading that registry.
        await vscode.commands.executeCommand('workbench.action.chat.open');
        const commandId = await waitForCustomAgentCommand(agentName);
        if (!commandId) {
            void vscode.window.showErrorMessage(
                vscode.l10n.t('The "{0}" Copilot agent did not finish loading. Please try again.', agentName),
            );
            return false;
        }

        await vscode.commands.executeCommand('workbench.action.chat.newChat');
        await vscode.commands.executeCommand(commandId, { query });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(
            vscode.l10n.t('The "{0}" Copilot agent could not be started: {1}', agentName, message),
        );
        return false;
    } finally {
        agentLaunchInProgress = false;
    }

    // Record the phase we just launched so an interrupted run can be resumed.
    try {
        await recordAgentLaunch(agentName);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ext.outputChannel.warn(vscode.l10n.t('Could not record the "{0}" Copilot agent launch: {1}', agentName, message));
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
    if (!(await launchAgentChat(agentName, prompt))) {
        return;
    }

    if (loading) {
        projectSubmissionState.setPending(loading.stage);
        openLoadingView(loading);
    }
}
