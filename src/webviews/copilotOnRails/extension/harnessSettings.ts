/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConfigurationTarget, workspace } from 'vscode';
import { settingUtils } from '../../../utils/settingUtils';

/**
 * The two experimental "Copilot Harness" chat settings used by Copilot on Rails:
 *   - "Chat > Editor: Prefer Copilot Harness (Experimental)"
 *   - "Chat > Default to Copilot Harness (Experimental)"
 */
const HARNESS_SETTINGS = [
    { prefix: 'chat.editor', key: 'preferCopilotHarness' },
    { prefix: 'chat', key: 'defaultToCopilotHarness' },
] as const;

export const COPILOT_HARNESS_SETTING_IDS = HARNESS_SETTINGS.map(({ prefix, key }) => `${prefix}.${key}`);

/**
 * Ensures Copilot on Rails uses the Copilot Harness by turning its two experimental settings on
 * at Workspace scope. Like the raised chat request
 * budget, the workspace override is cheap and disposable, so it is intentionally left in place.
 */
export async function ensureCopilotHarnessOn(): Promise<void> {
    const folder = workspace.workspaceFolders?.[0];
    if (!folder) {
        return;
    }
    for (const { prefix, key } of HARNESS_SETTINGS) {
        try {
            await settingUtils.updateWorkspaceSetting(key, true, folder.uri.fsPath, prefix, ConfigurationTarget.Workspace);
        } catch {
            // Best effort: the setting may be unknown on older VS Code versions.
        }
    }
}
