/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { type IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from 'vscode';
import { CreateProjectViewController } from "./controllers/CreateProjectViewController";
import { copilotOnRailsCommandIds } from "./copilotOnRailsCommands";

const localDev = vscode.l10n.t('Local Development');
const deploy = vscode.l10n.t('Deploy');

export async function createProjectWithCopilot(_context: IActionContext): Promise<void> {
    // Local Development => Deploy
    if (await hasCompletedPhase('.azure/vscode-debug-plan.md', 'implemented')) {
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
    if (await hasCompletedPhase('.azure/project-plan.md', 'scaffolded')) {
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

async function hasCompletedPhase(filePath: string, expectedStatus: string): Promise<boolean> {
    const files = await vscode.workspace.findFiles(filePath);
    if (!files.length) {
        return false;
    }

    const content = Buffer.from(await vscode.workspace.fs.readFile(files[0])).toString('utf-8');
    // [*_~]* allows markdown formatting (bold, italic, strikethrough) around "status"
    return new RegExp(`status[*_~]*\\s*:\\s*${expectedStatus}`, 'i').test(content);
}
