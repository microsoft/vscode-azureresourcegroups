/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../../../extensionVariables';

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
