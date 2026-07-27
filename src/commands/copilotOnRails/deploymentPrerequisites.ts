/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { homedir } from 'node:os';
import { gitHubCopilotForAzureExtensionId } from '../../constants';

const azurePrepareSkillName = 'azure-prepare';
const skillFileName = 'SKILL.md';
const installAzureSkillsLocallyCommandId = '@azure.installAzureSkillsLocally';

async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return (stat.type & vscode.FileType.File) !== 0;
    } catch {
        return false;
    }
}

async function hasAzurePrepareSkill(): Promise<boolean> {
    const roots = [
        vscode.Uri.joinPath(vscode.Uri.file(homedir()), '.agents'),
        ...(vscode.workspace.workspaceFolders?.map(folder => vscode.Uri.joinPath(folder.uri, '.agents')) ?? []),
    ];
    for (const root of roots) {
        if (await fileExists(vscode.Uri.joinPath(root, 'skills', azurePrepareSkillName, skillFileName))) {
            return true;
        }
    }
    return false;
}

export async function ensureAzureDeploymentPrerequisites(): Promise<boolean> {
    let copilotForAzure = vscode.extensions.getExtension(gitHubCopilotForAzureExtensionId);
    const hasSkill = await hasAzurePrepareSkill();
    if (copilotForAzure && hasSkill) {
        return true;
    }

    const install = copilotForAzure ? vscode.l10n.t('Install Skill') : vscode.l10n.t('Install');
    const message = copilotForAzure
        ? vscode.l10n.t('Deployment requires the "{0}" skill from GitHub Copilot for Azure. Install the skill to continue?', azurePrepareSkillName)
        : vscode.l10n.t('Deployment requires the GitHub Copilot for Azure extension and its "{0}" skill. Install the extension to continue?', azurePrepareSkillName);
    const choice = await vscode.window.showWarningMessage(message, { modal: true }, install);
    if (choice !== install) {
        return false;
    }

    try {
        if (!copilotForAzure) {
            await vscode.commands.executeCommand('workbench.extensions.installExtension', gitHubCopilotForAzureExtensionId);
            copilotForAzure = vscode.extensions.getExtension(gitHubCopilotForAzureExtensionId);
        }
        if (!copilotForAzure) {
            throw new Error('GitHub Copilot for Azure was not installed.');
        }

        await copilotForAzure.activate();
        if (!(await hasAzurePrepareSkill())) {
            await vscode.commands.executeCommand(installAzureSkillsLocallyCommandId);
        }
        if (await hasAzurePrepareSkill()) {
            return true;
        }
    } catch {
        // The install command rejects when installation is canceled or fails.
    }

    void vscode.window.showErrorMessage(
        vscode.l10n.t('GitHub Copilot for Azure with the "{0}" skill is required to start deployment.', azurePrepareSkillName),
    );
    return false;
}