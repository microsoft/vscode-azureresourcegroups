/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtFsExtra, IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';

/** Folder (relative to the workspace root) where instruction folders are downloaded. */
const WORKSPACE_AGENTS_RELATIVE_PATH = ['.github', 'agents'];

/** Every instruction folder bundled with the extension (under `resources/agents`). */
const agentInstructionFolders: string[] = [
    'azure-debug-generate',
    'azure-debug-plan',
    'azure-project-plan',
    'azure-project-scaffold',
    'azure-project-test',
    'shared-references',
];

/** Root of the instruction folders bundled with the extension. */
function getBundledAgentsRoot(): vscode.Uri {
    return vscode.Uri.joinPath(ext.context.extensionUri, 'resources', 'agents');
}

/** Root of the instruction folders inside the user's workspace (`.github/agents`), or `undefined` when no workspace is open. */
function getWorkspaceAgentsRoot(): vscode.Uri | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        return undefined;
    }
    return vscode.Uri.joinPath(folder.uri, ...WORKSPACE_AGENTS_RELATIVE_PATH);
}

/** Copies each of the given instruction folders from the extension bundle into the workspace, replacing any existing copies. */
async function copyInstructionFolders(folders: string[], agentsRoot: vscode.Uri): Promise<void> {
    const bundledRoot = getBundledAgentsRoot();
    for (const folder of folders) {
        const source = vscode.Uri.joinPath(bundledRoot, folder);
        const dest = vscode.Uri.joinPath(agentsRoot, folder);
        await AzExtFsExtra.copy(source, dest, { overwrite: true });
    }
}

/**
 * Ensures the bundled instruction files are present in the workspace before an agent is invoked.
 *
 * - When any folder is missing, the user is asked whether to download them. Declining
 *   returns `false` so the caller can abort the agent invocation.
 * - When all folders are already present, returns `true` immediately without any prompts.
 *
 * No-ops (returns `true`) when no workspace is open.
 */
export async function ensureAgentInstructions(agentName: string): Promise<boolean> {
    const agentsRoot = getWorkspaceAgentsRoot();
    if (!agentsRoot) {
        return true;
    }

    const missingFolders: string[] = [];
    for (const folder of agentInstructionFolders) {
        if (!(await AzExtFsExtra.pathExists(vscode.Uri.joinPath(agentsRoot, folder)))) {
            missingFolders.push(folder);
        }
    }

    if (missingFolders.length === 0) {
        return true;
    }

    const download = vscode.l10n.t('Download');
    const choice = await vscode.window.showInformationMessage(
        vscode.l10n.t('The "{0}" agent needs its instruction files in your workspace to run correctly.', agentName),
        {
            modal: true,
            detail: vscode.l10n.t('These files contain the step-by-step instructions the agent follows. They will be downloaded to ".github/agents". Without them, the agent cannot complete its workflow.'),
        },
        download,
    );
    if (choice !== download) {
        return false;
    }

    await copyInstructionFolders(missingFolders, agentsRoot);
    return true;
}

/**
 * Command handler that downloads all agent instruction folders into the workspace.
 *
 * When invoked (e.g. from the Command Palette) the user is not prompted —
 * running the command is treated as explicit consent to write into `.github/agents`.
 */
export async function downloadAgentInstructions(_context: IActionContext): Promise<void> {
    const agentsRoot = getWorkspaceAgentsRoot();
    if (!agentsRoot) {
        throw new Error(vscode.l10n.t('Open a folder or workspace before downloading Azure agent instructions.'));
    }

    await copyInstructionFolders(agentInstructionFolders, agentsRoot);
    void vscode.window.showInformationMessage(vscode.l10n.t('Azure agent instructions downloaded to ".github/agents".'));
}
