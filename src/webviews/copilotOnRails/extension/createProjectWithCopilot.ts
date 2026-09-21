/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtFsExtra, UserCancelledError } from "@microsoft/vscode-azext-utils";
import * as vscode from 'vscode';
import { copilotOnRailsCommandIds } from "../../../commands/copilotOnRails/registerCopilotOnRailsCommands";
import { DEBUG_PLAN_FILE_GLOB, PROJECT_PLAN_FILE_GLOB } from "../../../tree/project/projectPlanFiles";
import { CopilotOnRailsContext } from "../../../utils/copilotOnRails/CopilotOnRailsContext";
import { getDefaultOpusModelOption, getSupportedModelOptions } from "../../../utils/copilotOnRails/modelSelection";
import { setCorProp } from "../../../utils/copilotOnRails/telemetryUtils";
import { CreateProjectViewController } from "./controllers/CreateProjectViewController";
import { getRecentPrompts } from "./recentPrompts";
import { consumeReloadResumePrompt } from "./reloadResumePrompt";
import { writePendingCreateMarker } from "./resumePendingCreateWithCopilot";

const localDev = vscode.l10n.t('Local Development');
const deploy = vscode.l10n.t('Deploy');
export const OPEN_PROJECT_FOLDER_OPTIONS = { forceNewWindow: true } as const;
export const PROJECT_FOLDER_SELECTION_TELEMETRY_KEY = 'projectFolderSelection';
export type ProjectFolderSelection = 'newSubfolder' | 'selectedEmptyFolder';

export async function createProjectWithCopilot(context: CopilotOnRailsContext): Promise<void> {
    if (!(await ensureFreshWorkspace(context))) {
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
    await openCreateProjectView();
}

/** Re-opens the create view pre-filled after a reload-to-discover-agents; no-ops when nothing was stashed. */
export async function resumeCreateProjectViewAfterReload(): Promise<void> {
    const resume = await consumeReloadResumePrompt();
    if (resume) {
        await openCreateProjectView(resume.prompt, resume.model);
    }
}

async function openCreateProjectView(initialPrompt?: string, initialModel?: string): Promise<void> {
    const availableModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    const modelOptions = getSupportedModelOptions(availableModels);
    const selectedModel = initialModel && modelOptions.includes(initialModel)
        ? initialModel
        : getDefaultOpusModelOption(availableModels);
    const controller = new CreateProjectViewController({
        title: vscode.l10n.t('Create with Copilot'),
        heading: vscode.l10n.t('What would you like to build?'),
        subtitle: vscode.l10n.t('Describe your project and Copilot will help you build and deploy it to Azure.'),
        promptPlaceholder: vscode.l10n.t('Describe your project...'),
        hint: vscode.l10n.t('Ctrl+Enter to plan'),
        planButtonLabel: vscode.l10n.t('Plan'),
        modelLabel: vscode.l10n.t('Model'),
        modelOptions,
        recentPrompts: getRecentPrompts(),
        initialPrompt,
        initialModel: selectedModel,
    });
    controller.revealToForeground();
}

/**
 * Ensures the flow starts from a suitable blank slate.
 * If no folder is open, or the open folder already contains project content, we offer the
 * choice to create a subfolder or select an empty folder, then open the target as the
 * project workspace.
 *
 * Returns true when the flow can continue in the current window, false when
 * we're opening a different folder (in which case the flow resumes
 * automatically via the pending-create marker). Throws if the user cancels or
 * picks a folder that isn't empty.
 */
async function ensureFreshWorkspace(context: CopilotOnRailsContext): Promise<boolean> {
    const currentFolder = vscode.workspace.workspaceFolders?.[0];

    if (await isWorkspaceEmpty()) {
        return true;
    }

    const createSubfolder: vscode.MessageItem = { title: vscode.l10n.t('Create in New Subfolder...') };
    const chooseEmptyFolder: vscode.MessageItem = { title: vscode.l10n.t('Choose Empty Folder...') };
    const actions = currentFolder ? [createSubfolder, chooseEmptyFolder] : [chooseEmptyFolder];
    const choice = await context.ui.showWarningMessage(
        vscode.l10n.t('Choose where to create your project.'),
        {
            modal: true,
            detail: currentFolder
                ? vscode.l10n.t('"{0}" contains files. Create a subfolder or choose an empty folder. The project opens in a new window.', folderName(currentFolder.uri))
                : vscode.l10n.t('Choose an empty folder. The project opens in a new window.'),
        },
        ...actions,
    );

    let target: vscode.Uri;
    let selection: ProjectFolderSelection;
    if (choice === createSubfolder && currentFolder) {
        target = await createProjectSubfolder(context, currentFolder.uri);
        selection = 'newSubfolder';
    } else if (choice === chooseEmptyFolder) {
        target = await pickEmptyProjectFolder(context, currentFolder?.uri);
        selection = 'selectedEmptyFolder';
    } else {
        throw new UserCancelledError('selectProjectFolder');
    }

    if (!(await isFolderEmpty(target))) {
        throw new Error(vscode.l10n.t('"{0}" already contains files. Creating a project with Copilot requires an empty project folder.', folderName(target)));
    }

    recordProjectFolderSelection(context, selection);
    await writePendingCreateMarker(target);
    await vscode.commands.executeCommand('vscode.openFolder', target, OPEN_PROJECT_FOLDER_OPTIONS);
    return false;
}

export function recordProjectFolderSelection(context: CopilotOnRailsContext, selection: ProjectFolderSelection): void {
    setCorProp(context, PROJECT_FOLDER_SELECTION_TELEMETRY_KEY, selection);
}

async function pickEmptyProjectFolder(context: CopilotOnRailsContext, currentFolder: vscode.Uri | undefined): Promise<vscode.Uri> {
    const picked = await context.ui.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: vscode.l10n.t('Select Folder'),
        title: vscode.l10n.t('Select an empty folder for your new project'),
        // Start one level up from the current folder, since the whole point is
        // to land somewhere other than where we are.
        defaultUri: currentFolder ? vscode.Uri.joinPath(currentFolder, '..') : undefined,
    });

    const target = picked?.[0];
    if (!target) {
        throw new UserCancelledError('selectProjectFolder');
    }

    return target;
}

async function createProjectSubfolder(context: CopilotOnRailsContext, parent: vscode.Uri): Promise<vscode.Uri> {
    const input = await context.ui.showInputBox({
        title: vscode.l10n.t('Create a Project Subfolder'),
        prompt: vscode.l10n.t('Enter a name for the new project folder inside "{0}".', folderName(parent)),
        placeHolder: vscode.l10n.t('my-project'),
        validateInput: validateProjectSubfolderName,
        asyncValidationTask: async (value) => {
            if (validateProjectSubfolderName(value)) {
                return undefined;
            }

            const target = vscode.Uri.joinPath(parent, value.trim());
            return (await AzExtFsExtra.pathExists(target))
                ? vscode.l10n.t('A file or folder with this name already exists.')
                : undefined;
        },
    });

    const validationMessage = validateProjectSubfolderName(input);
    if (validationMessage) {
        throw new Error(validationMessage);
    }

    const target = vscode.Uri.joinPath(parent, input.trim());
    if (await AzExtFsExtra.pathExists(target)) {
        throw new Error(vscode.l10n.t('"{0}" already exists. Choose a different project folder name.', folderName(target)));
    }

    await AzExtFsExtra.ensureDir(target);
    return target;
}

/** Returns a user-facing validation message when `value` is not a safe direct child folder name. */
export function validateProjectSubfolderName(value: string): string | undefined {
    const name = value.trim();
    if (!name) {
        return vscode.l10n.t('Enter a folder name.');
    }

    if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
        return vscode.l10n.t('Enter a single folder name without path separators.');
    }

    return undefined;
}

async function hasCompletedPhase(filePath: string, expectedStatus: string): Promise<boolean> {
    const files = await vscode.workspace.findFiles(filePath);
    if (!files.length) {
        return false;
    }

    const content = await AzExtFsExtra.readFile(files[0]);
    // [*_~]* allows markdown formatting (bold, italic, strikethrough) around "status"
    return new RegExp(`status[*_~]*\\s*:\\s*${expectedStatus}`, 'i').test(content);
}

/** Display name of a folder uri, for user-facing messages. */
function folderName(uri: vscode.Uri): string {
    return uri.path.split('/').filter(Boolean).pop() ?? uri.fsPath;
}

/** Entries that don't count as real project content when checking for a blank slate. */
const IGNORED_ENTRIES = new Set(['.git', '.DS_Store']);

/**
 * Content the extension writes into the workspace itself — agent instructions land in
 * `.github/agents` and the harness overrides in `.vscode/settings.json`. A folder that holds
 * nothing but what we put there is still a blank slate from the user's point of view, so
 * these folders are only disqualifying when they contain something we didn't write.
 */
const EXTENSION_OWNED_ENTRIES: Record<string, ReadonlySet<string>> = {
    '.github': new Set(['agents']),
    '.vscode': new Set(['settings.json']),
};

async function isFolderEmpty(folder: vscode.Uri): Promise<boolean> {
    try {
        const entries = await AzExtFsExtra.readDirectory(folder);
        for (const { name } of entries) {
            if (IGNORED_ENTRIES.has(name)) {
                continue;
            }

            const owned = EXTENSION_OWNED_ENTRIES[name];
            if (owned && (await containsOnly(vscode.Uri.joinPath(folder, name), owned))) {
                continue;
            }

            return false;
        }
        return true;
    } catch {
        return false;
    }
}

/** True when every entry in `folder` is either allowed or otherwise ignorable. */
async function containsOnly(folder: vscode.Uri, allowed: ReadonlySet<string>): Promise<boolean> {
    try {
        const entries = await AzExtFsExtra.readDirectory(folder);
        return entries.every(({ name }) => allowed.has(name) || IGNORED_ENTRIES.has(name));
    } catch {
        return false;
    }
}

async function isWorkspaceEmpty(): Promise<boolean> {
    // Copilot on Rails isn't really intended for use with multi-root
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder ? await isFolderEmpty(folder.uri) : false;
}
