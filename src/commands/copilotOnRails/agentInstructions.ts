/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, UserCancelledError } from '@microsoft/vscode-azext-utils';
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

/**
 * Maps each contributed chat agent to the instruction folders (under
 * `resources/agents`) it relies on at runtime. Agents that don't ship bundled
 * instruction folders (e.g. `azure-deploy`, which reads an external skill) are
 * intentionally omitted.
 */
const agentInstructionFolders: Record<string, string[]> = {
    'azure-project-plan': ['azure-project-plan', 'shared-references'],
    'azure-project-scaffold': ['azure-project-scaffold', 'shared-references'],
    'azure-debug-plan': ['azure-debug-plan'],
    'azure-debug-generate': ['azure-debug-generate'],
};

/** Every distinct instruction folder across all agents. */
const allInstructionFolders: string[] = [...new Set(Object.values(agentInstructionFolders).flat())];

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
 * Ensures the bundled instruction files for `agentName` are present (and up to date)
 * in the workspace before the agent is invoked.
 *
 * - When the files are missing, the user is asked whether to download them. Declining
 *   throws a {@link UserCancelledError} so the caller aborts the agent invocation.
 * - When the files are present but a newer version is bundled, the user is asked
 *   whether to upgrade. Declining keeps the existing files and continues.
 *
 * No-ops for agents that don't ship bundled instructions and when no workspace is open.
 */
export async function ensureAgentInstructions(agentName: string): Promise<void> {
    const folders = agentInstructionFolders[agentName];
    if (!folders || folders.length === 0) {
        return;
    }

    const agentsRoot = getWorkspaceAgentsRoot();
    if (!agentsRoot) {
        return;
    }

    const { anyMissing, anyOutdated } = await getInstructionState(folders, agentsRoot);
    if (!anyMissing && !anyOutdated) {
        return;
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
            throw new UserCancelledError('downloadAgentInstructions');
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
            return;
        }
    }

    await copyInstructionFolders(folders, agentsRoot);
}

/**
 * Command handler that downloads agent instruction folders into the workspace.
 *
 * When invoked directly (e.g. from the Command Palette) the user is not prompted —
 * running the command is treated as explicit consent to write into `.github/agents`.
 * An optional `agentName` limits the download to a single agent's folders; otherwise
 * every agent's instructions are downloaded.
 */
export async function downloadAgentInstructions(_context: IActionContext, agentName?: string): Promise<void> {
    const agentsRoot = getWorkspaceAgentsRoot();
    if (!agentsRoot) {
        throw new Error(vscode.l10n.t('Open a folder or workspace before downloading Azure agent instructions.'));
    }

    const folders = agentName ? (agentInstructionFolders[agentName] ?? []) : allInstructionFolders;
    if (folders.length === 0) {
        throw new Error(vscode.l10n.t('No instruction files are available for the "{0}" agent.', agentName ?? ''));
    }

    await copyInstructionFolders(folders, agentsRoot);
    void vscode.window.showInformationMessage(vscode.l10n.t('Azure agent instructions downloaded to ".github/agents".'));
}
