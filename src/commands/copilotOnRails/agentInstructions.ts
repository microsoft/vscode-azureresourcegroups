/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';

/** Name of the metadata file bundled alongside each instruction folder. */
const METADATA_FILE = '.metadata.json';

/** Folder (relative to the workspace root) where instruction folders are downloaded. */
const WORKSPACE_AGENTS_RELATIVE_PATH = ['.github', 'agents'];

interface AgentInstructionMetadata {
    name: string;
    version: string;
}

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

/** Reads the `version` field from a `.metadata.json` file, or `undefined` if it's missing/unreadable. */
async function readInstructionVersion(metadataUri: vscode.Uri): Promise<string | undefined> {
    try {
        const bytes = await vscode.workspace.fs.readFile(metadataUri);
        const parsed = JSON.parse(Buffer.from(bytes).toString('utf-8')) as Partial<AgentInstructionMetadata>;
        return typeof parsed.version === 'string' ? parsed.version : undefined;
    } catch {
        return undefined;
    }
}

/** Copies the given instruction folders from the extension bundle into the workspace, replacing any existing copies. */
async function copyInstructionFolders(folders: string[], agentsRoot: vscode.Uri): Promise<void> {
    const bundledRoot = getBundledAgentsRoot();
    for (const folder of folders) {
        const source = vscode.Uri.joinPath(bundledRoot, folder);
        const dest = vscode.Uri.joinPath(agentsRoot, folder);
        try {
            await vscode.workspace.fs.delete(dest, { recursive: true, useTrash: false });
        } catch {
            // Nothing to remove yet — this is the first download.
        }
        await vscode.workspace.fs.copy(source, dest, { overwrite: true });
    }
}

interface InstructionState {
    anyMissing: boolean;
    anyOutdated: boolean;
}

/** Compares the bundled instruction versions against what's installed in the workspace. */
async function getInstructionState(folders: string[], agentsRoot: vscode.Uri): Promise<InstructionState> {
    const bundledRoot = getBundledAgentsRoot();
    let anyMissing = false;
    let anyOutdated = false;
    for (const folder of folders) {
        const bundledVersion = await readInstructionVersion(vscode.Uri.joinPath(bundledRoot, folder, METADATA_FILE));
        const installedVersion = await readInstructionVersion(vscode.Uri.joinPath(agentsRoot, folder, METADATA_FILE));
        if (installedVersion === undefined) {
            anyMissing = true;
        } else if (bundledVersion !== undefined && installedVersion !== bundledVersion) {
            anyOutdated = true;
        }
    }
    return { anyMissing, anyOutdated };
}

/**
 * Ensures the bundled instruction files are present (and up to date) in the workspace
 * before an agent is invoked.
 *
 * - When the files are missing, the user is asked whether to download them. Declining
 *   returns `false` so the caller can abort the agent invocation.
 * - When the files are present but a newer version is bundled, the user is asked
 *   whether to upgrade. Declining keeps the existing files and returns `true` —
 *   having any version of the files is sufficient to proceed.
 *
 * Returns `true` (proceed) in all cases except: files missing **and** user declined download.
 * No-ops (returns `true`) when no workspace is open.
 */
export async function ensureAgentInstructions(agentName: string): Promise<boolean> {
    const agentsRoot = getWorkspaceAgentsRoot();
    if (!agentsRoot) {
        return true;
    }

    const { anyMissing, anyOutdated } = await getInstructionState(agentInstructionFolders, agentsRoot);
    if (!anyMissing && !anyOutdated) {
        return true;
    }

    if (anyMissing) {
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
    } else {
        const upgrade = vscode.l10n.t('Upgrade');
        const choice = await vscode.window.showInformationMessage(
            vscode.l10n.t('A newer version of the "{0}" agent instruction files is available.', agentName),
            {
                modal: true,
                detail: vscode.l10n.t('Your workspace has an older version of these instructions in ".github/agents". Upgrade to the latest version?'),
            },
            upgrade,
        );
        if (choice !== upgrade) {
            return true;
        }
    }

    await copyInstructionFolders(agentInstructionFolders, agentsRoot);
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
