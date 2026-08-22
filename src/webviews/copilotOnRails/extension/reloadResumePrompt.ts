/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../../../extensionVariables';

/**
 * When a create-with-copilot launch is blocked because Workspace Trust was granted mid-session,
 * we reload the window so Copilot Chat can discover the project's custom agents (see
 * `promptReloadForAgentDiscovery` in `openChatWithAgent.ts`). The reload tears down the create
 * view, so we stash the user's prompt here first and re-open the view pre-filled on the next
 * activation - the user just presses Plan again, this time in a healthy window that downloads
 * and launches the agent normally.
 *
 * `workspaceState` survives a window reload (same folder, same window), which is exactly the
 * hand-off we need. A timestamp bounds how long a stashed prompt stays valid, so a reload that
 * never happened (or happened much later) can't resurface a stale prompt.
 */
const RELOAD_RESUME_PROMPT_KEY = 'azureResourceGroups.copilotOnRails.reloadResumePrompt';
const RELOAD_RESUME_TIMEOUT_MS = 10 * 60 * 1000;

interface ReloadResumePrompt {
    prompt: string;
    model?: string;
    /** Epoch ms at which the prompt was stashed. */
    savedAt: number;
}

export async function saveReloadResumePrompt(prompt: string, model?: string): Promise<void> {
    const value: ReloadResumePrompt = { prompt, model, savedAt: Date.now() };
    await ext.context.workspaceState.update(RELOAD_RESUME_PROMPT_KEY, value);
}

/**
 * Returns the stashed create prompt and clears it, so it resumes at most once. Returns
 * undefined when there is nothing to resume or the stash has expired.
 */
export async function consumeReloadResumePrompt(): Promise<{ prompt: string; model?: string } | undefined> {
    const value = ext.context.workspaceState.get<ReloadResumePrompt>(RELOAD_RESUME_PROMPT_KEY);
    if (value === undefined) {
        return undefined;
    }
    await ext.context.workspaceState.update(RELOAD_RESUME_PROMPT_KEY, undefined);
    if (Date.now() - value.savedAt > RELOAD_RESUME_TIMEOUT_MS) {
        return undefined;
    }
    return { prompt: value.prompt, model: value.model };
}
