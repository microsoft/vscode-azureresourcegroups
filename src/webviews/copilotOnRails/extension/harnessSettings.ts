/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConfigurationTarget, workspace } from 'vscode';
import { ext } from '../../../extensionVariables';
import { settingUtils } from '../../../utils/settingUtils';

/**
 * The experimental chat settings that decide whether Copilot on Rails runs on the VS Code
 * **local** (extension-host) chat harness — the harness where the extension's MCP tools,
 * custom `azure-*` agents, and pinned models are actually available. Each is forced to its
 * `value` at Workspace scope for the run (cheap, disposable, intentionally left in place):
 *
 *   - `chat.editor.preferCopilotHarness` → **false**: don't silently upgrade a resolved local
 *     session to the Agent Host Copilot harness.
 *   - `chat.defaultToCopilotHarness` → **false**: keep the computed default on the local harness
 *     rather than defaulting new sessions to Agent Host Copilot.
 *   - `chat.editor.localAgent.enabled` → **true**: keep the VS Code local harness available and
 *     selectable in the chat picker. Its default is already `true`, but a VS Code update, another
 *     extension, or a stale profile can flip it off, which hides the local harness entirely — so
 *     we reassert it.
 *
 * These three settings govern the *computed default* session type. They do **not** override a
 * "remembered" session type persisted in `chat.userSelectedSessionType` (VS Code profile storage):
 * if the user previously picked an Agent Host harness (Copilot/Claude/Codex), that remembered
 * choice still wins, and VS Code exposes no extension API to clear it (tracked at
 * https://github.com/microsoft/vscode/issues/333154). In that case the user must pick **Local**
 * once from the chat session-type picker; after that these settings keep it there.
 */
const HARNESS_SETTINGS = [
    { prefix: 'chat.editor', key: 'preferCopilotHarness', value: false },
    { prefix: 'chat', key: 'defaultToCopilotHarness', value: false },
    { prefix: 'chat.editor', key: 'localAgent.enabled', value: true },
] as const;

export const COPILOT_HARNESS_SETTING_IDS = HARNESS_SETTINGS.map(({ prefix, key }) => `${prefix}.${key}`);

/**
 * Reasserts the VS Code local chat harness for a Copilot on Rails run by forcing the harness
 * settings above at Workspace scope. Best-effort: a setting may be unknown on an older VS Code,
 * and a remembered Agent Host session type can still override the computed default (see the note
 * on {@link HARNESS_SETTINGS}). Failures are logged rather than swallowed so a wrong-harness run
 * is at least diagnosable from the output channel.
 */
export async function ensureLocalHarnessOn(): Promise<void> {
    const folder = workspace.workspaceFolders?.[0];
    if (!folder) {
        return;
    }
    for (const { prefix, key, value } of HARNESS_SETTINGS) {
        const settingId = `${prefix}.${key}`;
        try {
            await settingUtils.updateWorkspaceSetting(key, value, folder.uri.fsPath, prefix, ConfigurationTarget.Workspace);
        } catch (err) {
            // Best effort: the setting may be unknown on this VS Code version. Log so a
            // wrong-harness run can be traced instead of failing invisibly.
            const message = err instanceof Error ? err.message : String(err);
            ext.outputChannel.appendLog(`[CopilotOnRails] Could not set "${settingId}"=${value} to keep the local chat harness: ${message}`);
        }
    }
}
