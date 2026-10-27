/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../../../extensionVariables';

export const RECENT_PROMPTS_KEY = 'azureResourceGroups.copilotOnRails.recentPrompts';
export const RECENT_PROMPT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const RECENT_PROMPT_MAX_COUNT = 25;

export type CopilotOnRailsRecentPrompt = {
    prompt: string;
    /** Epoch ms at which the prompt was submitted (i.e. `Date.now()`). */
    timestamp: number;
};

export function pruneRecentPrompts(existing: CopilotOnRailsRecentPrompt[], now: number): CopilotOnRailsRecentPrompt[] {
    const cutoff = now - RECENT_PROMPT_MAX_AGE_MS;
    return existing.filter((entry) => entry.timestamp >= cutoff);
}

export function addRecentPrompt(existing: CopilotOnRailsRecentPrompt[], prompt: string, now: number): CopilotOnRailsRecentPrompt[] {
    const trimmed = prompt.trim();
    if (!trimmed) {
        return existing;
    }

    const withoutDuplicate = existing.filter((entry) => entry.prompt !== trimmed);
    const next: CopilotOnRailsRecentPrompt[] = [{ prompt: trimmed, timestamp: now }, ...withoutDuplicate];
    return pruneRecentPrompts(next, now).slice(0, RECENT_PROMPT_MAX_COUNT);
}

export function toPromptStrings(existing: CopilotOnRailsRecentPrompt[]): string[] {
    return existing.map((entry) => entry.prompt);
}

/** Returns recent prompts ordered from most to least recent (index 0 is the newest prompt). */
export function getRecentPrompts(): string[] {
    const stored = ext.context.globalState.get<CopilotOnRailsRecentPrompt[]>(RECENT_PROMPTS_KEY) ?? [];
    return toPromptStrings(pruneRecentPrompts(stored, Date.now()));
}

export async function recordRecentPrompt(prompt: string): Promise<void> {
    const stored = ext.context.globalState.get<CopilotOnRailsRecentPrompt[]>(RECENT_PROMPTS_KEY) ?? [];
    const updated = addRecentPrompt(stored, prompt, Date.now());
    await ext.context.globalState.update(RECENT_PROMPTS_KEY, updated);
}
