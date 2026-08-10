/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../../../extensionVariables';

export type RecentPrompt = { prompt: string; ts: number };

export const RECENT_PROMPT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const RECENT_PROMPT_MAX_COUNT = 25;

// globalState (not workspaceState): the create flow opens a fresh empty folder per
// project, so a workspace-scoped history would never surface a prior project's prompts.
export const RECENT_PROMPTS_KEY = 'azureResourceGroups.copilotOnRails.recentPrompts';

/** Drops entries older than the retention window; keeps newest-first order. */
export function pruneRecentPrompts(existing: RecentPrompt[], now: number): RecentPrompt[] {
    const cutoff = now - RECENT_PROMPT_MAX_AGE_MS;
    return existing.filter((entry) => entry.ts >= cutoff);
}

/** Records `prompt` as the newest entry; ignores blank input, dedupes by moving an existing match to the front. */
export function addRecentPrompt(existing: RecentPrompt[], prompt: string, now: number): RecentPrompt[] {
    const trimmed = prompt.trim();
    if (!trimmed) {
        return existing;
    }

    const withoutDuplicate = existing.filter((entry) => entry.prompt !== trimmed);
    const next: RecentPrompt[] = [{ prompt: trimmed, ts: now }, ...withoutDuplicate];
    return pruneRecentPrompts(next, now).slice(0, RECENT_PROMPT_MAX_COUNT);
}

export function toPromptStrings(existing: RecentPrompt[]): string[] {
    return existing.map((entry) => entry.prompt);
}

export function getRecentPrompts(): string[] {
    const stored = ext.context.globalState.get<RecentPrompt[]>(RECENT_PROMPTS_KEY) ?? [];
    return toPromptStrings(pruneRecentPrompts(stored, Date.now()));
}

export async function recordRecentPrompt(prompt: string): Promise<void> {
    const stored = ext.context.globalState.get<RecentPrompt[]>(RECENT_PROMPTS_KEY) ?? [];
    const updated = addRecentPrompt(stored, prompt, Date.now());
    await ext.context.globalState.update(RECENT_PROMPTS_KEY, updated);
}
