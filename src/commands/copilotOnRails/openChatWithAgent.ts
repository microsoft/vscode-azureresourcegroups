/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

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

export async function openChatWithAgent(agentName: string, prompt: string): Promise<void> {
    if (!(await ensureCopilotChatReady())) {
        return;
    }
    await vscode.commands.executeCommand('workbench.action.chat.open', {
        mode: agentName,
        query: prompt,
    });
}
