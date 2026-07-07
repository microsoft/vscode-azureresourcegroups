/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { openChatWithAgent } from '../../../commands/copilotOnRails/openChatWithAgent';
import { buildResumePrompt, readSessionState, resumeAgentFor } from './projectSession';

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

    await openChatWithAgent(resumeAgentFor(state.phase), buildResumePrompt(state));
}
