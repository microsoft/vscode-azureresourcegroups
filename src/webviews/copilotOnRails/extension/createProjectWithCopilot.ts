/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { type IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from 'vscode';
import { copilotOnRailsCommandIds } from "../../../commands/copilotOnRails/registerCopilotOnRailsCommands";
import { ext } from "../../../extensionVariables";
import { DEBUG_PLAN_FILE_GLOB, PROJECT_PLAN_FILE_GLOB } from "../../../tree/project/projectPlanFiles";
import { CreateProjectViewController } from "./controllers/CreateProjectViewController";

const localDev = vscode.l10n.t('Local Development');
const deploy = vscode.l10n.t('Deploy');

/**
 * globalState key holding the epoch-ms deadline until which a pending "Create
 * with Copilot" request should auto-resume after a folder is opened.
 */
const PENDING_CREATE_DEADLINE_KEY = 'azureResourceGroups.createProjectWithCopilot.pendingDeadline';
/** How long a pending create request stays valid across a window reload. */
const PENDING_CREATE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * If the user previously pressed "Create with Copilot" without an open folder
 * and chose to open one, re-runs the command once the folder is open. Call this
 * during activation. No-ops when there's no pending request or it has expired.
 */
export async function resumePendingCreateWithCopilot(context: vscode.ExtensionContext): Promise<void> {
    const deadline = context.globalState.get<number>(PENDING_CREATE_DEADLINE_KEY);
    if (deadline === undefined) {
        return;
    }

    // Consume the flag regardless of outcome so it only ever fires once.
    await context.globalState.update(PENDING_CREATE_DEADLINE_KEY, undefined);

    const folders = vscode.workspace.workspaceFolders;
    if (Date.now() > deadline || !folders || folders.length === 0) {
        return;
    }

    await vscode.commands.executeCommand(copilotOnRailsCommandIds.createProjectWithCopilot);
}

export async function createProjectWithCopilot(_context: IActionContext): Promise<void> {
    if (!(await ensureWorkspaceOpen())) {
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
    });
    controller.revealToForeground();
}

/**
 * Ensures there is an open folder/workspace to create the project in. If none is
 * open, prompts the user to open or create one. Returns true when a workspace is
 * (already) open and the flow can continue, false otherwise.
 */
async function ensureWorkspaceOpen(): Promise<boolean> {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        return true;
    }

    const openFolder = vscode.l10n.t('Open Folder...');
    const newWindow = vscode.l10n.t('New Empty Window');

    const choice = await vscode.window.showInformationMessage(
        vscode.l10n.t('Creating a project with Copilot requires an open folder. Open or create an empty folder to continue.'),
        { modal: true },
        openFolder,
        newWindow,
    );

    if (choice === openFolder) {
        await ext.context.globalState.update(PENDING_CREATE_DEADLINE_KEY, Date.now() + PENDING_CREATE_TIMEOUT_MS);
        await vscode.commands.executeCommand('workbench.action.files.openFolder');
    } else if (choice === newWindow) {
        await vscode.commands.executeCommand('workbench.action.newWindow');
    }

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
