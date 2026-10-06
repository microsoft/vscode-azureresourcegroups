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
const CLI_AUTO_MODEL_SETTING = { prefix: 'github.copilot.chat.cli', key: 'autoModel.enabled' } as const;

export const COPILOT_HARNESS_SETTING_IDS = HARNESS_SETTINGS.map(({ prefix, key }) => `${prefix}.${key}`);

/**
 * Enables the Copilot Harness and configures explicit Auto selection at Workspace scope. Like the raised chat request
 * budget, the workspace override is cheap and disposable, so it is intentionally left in place.
 */
export async function ensureCopilotHarnessOn(useAutoModel = false): Promise<void> {
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
    await setCopilotCliAutoModelEnabled(useAutoModel);
}

export async function setCopilotCliAutoModelEnabled(enabled: boolean): Promise<void> {
    const folder = workspace.workspaceFolders?.[0];
    if (!folder) {
        return;
    }
    const { prefix, key } = CLI_AUTO_MODEL_SETTING;
    if (workspace.getConfiguration(prefix, folder.uri).inspect(key)) {
        await settingUtils.updateWorkspaceSetting(key, enabled, folder.uri.fsPath, prefix, ConfigurationTarget.Workspace);
    }
}
