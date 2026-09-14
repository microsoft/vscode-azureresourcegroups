/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConfigurationTarget, workspace } from 'vscode';
import { settingUtils } from '../../../utils/settingUtils';

/**
 * The two experimental "Copilot Harness" chat settings that can silently auto-enable
 * across VS Code updates and break Copilot on Rails runs:
 *   - "Chat > Editor: Prefer Copilot Harness (Experimental)"
 *   - "Chat > Default to Copilot Harness (Experimental)"
 *
 * Both are booleans; turning them off keeps the local chat harness in use for the run.
 */
const HARNESS_SETTINGS = [
    { prefix: 'chat.editor', key: 'preferCopilotHarness' },
    { prefix: 'chat', key: 'defaultToCopilotHarness' },
] as const;

export const COPILOT_HARNESS_SETTING_IDS = HARNESS_SETTINGS.map(({ prefix, key }) => `${prefix}.${key}`);

/**
 * Ensures the local chat harness stays in use for a Copilot on Rails run by turning the two
 * experimental "Copilot Harness" settings off at Workspace scope. Like the raised chat request
 * budget, the workspace override is cheap and disposable, so it is intentionally left in place.
 */
export async function ensureLocalHarnessOn(): Promise<void> {
    const folder = workspace.workspaceFolders?.[0];
    if (!folder) {
        return;
    }
    for (const { prefix, key } of HARNESS_SETTINGS) {
        try {
            await settingUtils.updateWorkspaceSetting(key, false, folder.uri.fsPath, prefix, ConfigurationTarget.Workspace);
        } catch {
            // Best effort: the setting may be unknown on older VS Code versions.
        }
    }
}
