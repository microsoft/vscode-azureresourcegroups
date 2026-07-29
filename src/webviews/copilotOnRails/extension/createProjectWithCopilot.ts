/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from 'vscode';
import { copilotOnRailsCommandIds } from "../../../commands/copilotOnRails/registerCopilotOnRailsCommands";
import { DEBUG_PLAN_FILE_GLOB, PROJECT_PLAN_FILE_GLOB } from "../../../tree/project/projectPlanFiles";
import { CreateProjectViewController } from "./controllers/CreateProjectViewController";
import { writePendingCreateMarker } from "./resumePendingCreateWithCopilot";

const localDev = vscode.l10n.t('Local Development');
const deploy = vscode.l10n.t('Deploy');

export async function createProjectWithCopilot(_context: IActionContext): Promise<void> {
    if (!(await ensureFreshWorkspace())) {
        return;
    }

    // Local Development => Deploy
    if (await hasCompletedPhase(DEBUG_PLAN_FILE_GLOB, 'implemented')) {
        const choice = await vscode.window.showInformationMessage(
            vscode.l10n.t('We detected a previous Copilot session with a completed local debug configuration. Would you like to deploy this project?'),
            { modal: true },
            deploy,
        );

        if (choice === deploy) {
            await vscode.commands.executeCommand(copilotOnRailsCommandIds.startDeployment);
        }
        return;
    }

    // Create => Debug | Deploy
    if (await hasCompletedPhase(PROJECT_PLAN_FILE_GLOB, 'scaffolded')) {
        const choice = await vscode.window.showInformationMessage(
            vscode.l10n.t('We detected a previous Copilot session with a fully scaffolded project. How would you like to proceed?'),
            { modal: true },
            localDev,
            deploy,
        );

        if (choice === localDev) {
            await vscode.commands.executeCommand(copilotOnRailsCommandIds.startLocalDevelopment);
        } else if (choice === deploy) {
            await vscode.commands.executeCommand(copilotOnRailsCommandIds.startDeployment);
        }
        return;
    }

    // Nothing detected => start from scratch.
    const controller = new CreateProjectViewController({
        title: vscode.l10n.t('Create with Copilot'),
        heading: vscode.l10n.t('What would you like to build?'),
        subtitle: vscode.l10n.t('Describe your project and Copilot will help you build and deploy it to Azure.'),
        promptPlaceholder: vscode.l10n.t('Describe your project...'),
        hint: vscode.l10n.t('Ctrl+Enter to plan'),
        planButtonLabel: vscode.l10n.t('Plan'),
        modelLabel: vscode.l10n.t('Model'),
        modelOptions: [
            'Claude Opus 4.6 (copilot)',
            'Claude Opus 4.7 (copilot)',
            'Claude Sonnet 4.6 (copilot)',
        ],
    });
    controller.revealToForeground();
}

/**
 * Ensures the flow starts from a suitable blank slate.
 * If no folder is open, or the open folder already contains project content, we offer the
 * native folder picker and reopen VS Code on the chosen folder.
 *
 * Returns true when the flow can continue in the current window, false when
 * we're reopening on a different folder (in which case the flow resumes
 * automatically via the pending-create marker). Throws if the user cancels or
 * picks a folder that isn't empty.
 */
async function ensureFreshWorkspace(): Promise<boolean> {
    const currentFolder = vscode.workspace.workspaceFolders?.[0];

    if (await isWorkspaceEmpty()) {
        return true;
    }

    // Warn before the picker so the empty-folder requirement doesn't come as a
    // surprise, and so the user learns about it before we throw on a bad pick.
    const browse = vscode.l10n.t('Browse...');
    const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t('Creating a project with Copilot requires an empty folder.'),
        {
            modal: true,
            detail: currentFolder
                ? vscode.l10n.t('"{0}" already contains files. Choose an empty folder to build in — VS Code will reopen there and pick this flow back up.', folderName(currentFolder.uri))
                : vscode.l10n.t('Choose an empty folder to build in — VS Code will reopen there and pick this flow back up.'),
        },
        browse,
    );

    if (choice !== browse) {
        throw new UserCancelledError('selectProjectFolder');
    }

    const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: vscode.l10n.t('Select Folder'),
        title: vscode.l10n.t('Select an empty folder for your new project'),
        // Start one level up from the current folder, since the whole point is
        // to land somewhere other than where we are.
        defaultUri: currentFolder ? vscode.Uri.joinPath(currentFolder.uri, '..') : undefined,
    });

    const target = picked?.[0];
    if (!target) {
        throw new UserCancelledError('selectProjectFolder');
    }

    if (!(await isFolderEmpty(target))) {
        throw new Error(vscode.l10n.t('"{0}" already contains files. Creating a project with Copilot requires an empty folder.', folderName(target)));
    }

    await writePendingCreateMarker(target);
    await vscode.commands.executeCommand('vscode.openFolder', target);
    return false;
}

async function hasCompletedPhase(filePath: string, expectedStatus: string): Promise<boolean> {
    const files = await vscode.workspace.findFiles(filePath);
    if (!files.length) {
        return false;
    }

    const content = Buffer.from(await vscode.workspace.fs.readFile(files[0])).toString('utf-8');
    // [*_~]* allows markdown formatting (bold, italic, strikethrough) around "status"
    return new RegExp(`status[*_~]*\\s*:\\s*${expectedStatus}`, 'i').test(content);
}

/** Display name of a folder uri, for user-facing messages. */
function folderName(uri: vscode.Uri): string {
    return uri.path.split('/').filter(Boolean).pop() ?? uri.fsPath;
}

/** Entries that don't count as real project content when checking for a blank slate. */
const IGNORED_ENTRIES = new Set(['.git', '.DS_Store']);

async function isFolderEmpty(folder: vscode.Uri): Promise<boolean> {
    try {
        const entries = await vscode.workspace.fs.readDirectory(folder);
        return entries.every(([name]) => IGNORED_ENTRIES.has(name));
    } catch {
        return false;
    }
}

async function isWorkspaceEmpty(): Promise<boolean> {
    // Copilot on Rails isn't really intended for use with multi-root
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder ? await isFolderEmpty(folder.uri) : false;
}
