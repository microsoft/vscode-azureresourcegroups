/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';

/**
 * Agent instruction folders bundled with the extension under `resources/agents/<name>/`.
 *
 * Each folder ships an `instructions.md` plus a `references/` tree whose files cross-link
 * each other relatively (e.g. `classify.md`, `[inventory.md](inventory.md)`). The custom chat
 * agents (e.g. `azure-debug-plan`, `azure-debug-generate`) tell the model to read these from
 * the user's workspace at `.github/agents/<name>/instructions.md`. Because the relative
 * cross-links only resolve when the whole folder is co-located, the entire folder must be
 * copied into the workspace before the agents run.
 *
 * Nothing copies them automatically, so without this step the agents have no canonical
 * guidance and improvise — the opposite of the "MANDATORY COMPLIANCE / do not improvise"
 * contract the instructions assert. This list is the source of truth for which folders must
 * be present in the workspace before the project creation flow proceeds.
 */
export const requiredAgentInstructionFolders: readonly string[] = [
    'azure-debug-plan',
    'azure-debug-generate',
];

/** Directory (relative to the extension root) that holds the bundled instruction folders. */
const bundledAgentsDirSegments: readonly string[] = ['resources', 'agents'];

/** Directory (relative to a workspace root) where the agents expect to find the instructions. */
const workspaceAgentsDirSegments: readonly string[] = ['.github', 'agents'];

function getBundledAgentsRoot(): vscode.Uri {
    return vscode.Uri.joinPath(ext.context.extensionUri, ...bundledAgentsDirSegments);
}

function getWorkspaceAgentsRoot(workspaceFolder: vscode.WorkspaceFolder): vscode.Uri {
    return vscode.Uri.joinPath(workspaceFolder.uri, ...workspaceAgentsDirSegments);
}

async function directoryExists(uri: vscode.Uri): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return stat.type === vscode.FileType.Directory;
    } catch {
        return false;
    }
}

/**
 * Returns the subset of {@link requiredAgentInstructionFolders} that are not yet present under
 * `.github/agents/` in the given workspace folder.
 */
export async function getMissingAgentInstructionFolders(workspaceFolder: vscode.WorkspaceFolder): Promise<string[]> {
    const workspaceAgentsRoot = getWorkspaceAgentsRoot(workspaceFolder);
    const missing: string[] = [];
    for (const folder of requiredAgentInstructionFolders) {
        if (!(await directoryExists(vscode.Uri.joinPath(workspaceAgentsRoot, folder)))) {
            missing.push(folder);
        }
    }
    return missing;
}

/**
 * Recursively copies the given bundled instruction folders from the extension into the
 * workspace under `.github/agents/`. Existing files are overwritten so the workspace copy
 * stays in sync with the version shipped by the extension.
 */
export async function copyAgentInstructionFolders(workspaceFolder: vscode.WorkspaceFolder, folders: readonly string[]): Promise<void> {
    const bundledAgentsRoot = getBundledAgentsRoot();
    const workspaceAgentsRoot = getWorkspaceAgentsRoot(workspaceFolder);
    for (const folder of folders) {
        const source = vscode.Uri.joinPath(bundledAgentsRoot, folder);
        const target = vscode.Uri.joinPath(workspaceAgentsRoot, folder);
        await vscode.workspace.fs.copy(source, target, { overwrite: true });
    }
}

/**
 * Ensures the bundled agent instruction folders exist in the user's workspace.
 *
 * @param prompt When `true`, shows a modal asking the user to download the instructions before
 * copying (used by the automatic gate at the start of the project creation flow). When `false`,
 * copies the missing folders without prompting (used by the explicit "download instructions"
 * command).
 * @returns `true` if all required instruction folders are present after the call, `false` if
 * there is no open workspace or the user declined the download.
 */
export async function ensureAgentInstructionsInstalled(prompt: boolean): Promise<boolean> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        void vscode.window.showErrorMessage(
            vscode.l10n.t('Open a folder or workspace before creating an Azure project with Copilot.'),
        );
        return false;
    }

    const missing = await getMissingAgentInstructionFolders(workspaceFolder);
    if (missing.length === 0) {
        return true;
    }

    if (prompt) {
        const download = vscode.l10n.t('Download');
        const choice = await vscode.window.showInformationMessage(
            vscode.l10n.t('Creating an Azure project with Copilot requires instruction files that are not yet in this workspace. Download them into ".github/agents/" to continue?'),
            {
                modal: true,
                detail: vscode.l10n.t('The following instruction sets will be added: {0}', missing.join(', ')),
            },
            download,
        );
        if (choice !== download) {
            return false;
        }
    }

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Downloading Azure Copilot instructions...') },
        async () => { await copyAgentInstructionFolders(workspaceFolder, missing); },
    );
    return true;
}

/**
 * Command handler that installs (or refreshes) the bundled agent instruction folders in the
 * workspace without prompting. Exposed via the command palette so users can manually pull the
 * instructions the project creation agents depend on.
 */
export async function installAgentInstructions(_context: IActionContext): Promise<void> {
    const installed = await ensureAgentInstructionsInstalled(false);
    if (installed) {
        void vscode.window.showInformationMessage(
            vscode.l10n.t('Azure Copilot project instructions are installed in this workspace.'),
        );
    }
}
