/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError } from '@microsoft/vscode-azext-utils';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { gitHubCopilotForAzureExtensionId } from '../../constants';
import { CopilotOnRailsContext } from '../../utils/copilotOnRails/CopilotOnRailsContext';
import { setCorErrorProp, setCorProp } from '../../utils/copilotOnRails/telemetryUtils';

const execFileAsync = promisify(execFile);

const requiredDeploymentSkillNames = ['azure-app-onboard', 'azure-app-onboard-prereq', 'azure-prepare', 'azure-validate', 'azure-deploy'] as const;
const skillFileName = 'SKILL.md';
const installAzureSkillsLocallyCommandId = '@azure.installAzureSkillsLocally';

// Pin the azure-skills version installed into the workspace so deployment behavior stays reproducible.
// `installAzureSkillsLocally` always installs from `main`, so we run Copilot for Azure's bundled `skills`
// CLI directly against this tag and fall back to that command if the pinned install fails.
const pinnedAzureSkillsVersion = 'v1.2.25';
const azureSkillsRepo = 'microsoft/azure-skills';
const azureSkillsSubpath = '.github/plugins/azure-skills/skills';

function getPinnedAzureSkillsSourceUrl(): string {
    return `https://github.com/${azureSkillsRepo}/tree/${pinnedAzureSkillsVersion}/${azureSkillsSubpath}`;
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return (stat.type & vscode.FileType.File) !== 0;
    } catch {
        return false;
    }
}

async function hasRequiredDeploymentSkills(): Promise<boolean> {
    const roots = [
        vscode.Uri.joinPath(vscode.Uri.file(homedir()), '.agents'),
        ...(vscode.workspace.workspaceFolders?.map(folder => vscode.Uri.joinPath(folder.uri, '.agents')) ?? []),
    ];
    for (const root of roots) {
        const hasAllSkills = await Promise.all(
            requiredDeploymentSkillNames.map(skillName => fileExists(vscode.Uri.joinPath(root, 'skills', skillName, skillFileName))),
        );
        if (hasAllSkills.every(Boolean)) {
            return true;
        }
    }
    return false;
}

/**
 * Resolves the path to the `skills` CLI bundled inside the GitHub Copilot for Azure extension,
 * mirroring how that extension resolves its own CLI entry point from the package's `bin` field.
 */
async function resolveBundledSkillsCliPath(extension: vscode.Extension<unknown>): Promise<string | undefined> {
    try {
        const skillsDir = vscode.Uri.joinPath(vscode.Uri.file(extension.extensionPath), 'dist', 'node_modules', 'skills');
        const packageJson = JSON.parse(
            Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(skillsDir, 'package.json'))).toString('utf8'),
        ) as { bin?: string | Record<string, string> };

        let binRelativePath: string | undefined;
        if (typeof packageJson.bin === 'string') {
            binRelativePath = packageJson.bin;
        } else if (packageJson.bin && typeof packageJson.bin === 'object') {
            binRelativePath = packageJson.bin.skills ?? Object.values(packageJson.bin)[0];
        }

        if (!binRelativePath) {
            return undefined;
        }

        return vscode.Uri.joinPath(skillsDir, binRelativePath.replace(/^\.\//, '')).fsPath;
    } catch {
        return undefined;
    }
}

/**
 * Installs the pinned azure-skills into the first workspace folder using the CLI bundled with GitHub
 * Copilot for Azure. Returns `true` only when the required skills are present afterwards.
 */
async function installPinnedAzureDeploymentSkills(extension: vscode.Extension<unknown>): Promise<boolean> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder || workspaceFolder.uri.scheme !== 'file') {
        return false;
    }

    const cliPath = await resolveBundledSkillsCliPath(extension);
    if (!cliPath) {
        return false;
    }

    const env = { ...process.env };
    // Run the VS Code binary as a plain Node.js process so it executes the bundled CLI.
    env['ELECTRON_RUN_AS_NODE'] = '1';

    await execFileAsync(
        process.execPath,
        [cliPath, 'add', getPinnedAzureSkillsSourceUrl(), '-a', 'github-copilot', '-y'],
        {
            cwd: workspaceFolder.uri.fsPath,
            env,
            timeout: 120_000,
            maxBuffer: 10 * 1024 * 1024,
        },
    );

    return await hasRequiredDeploymentSkills();
}

export async function ensureAzureDeploymentPrerequisites(context: CopilotOnRailsContext): Promise<boolean> {
    let copilotForAzure = vscode.extensions.getExtension(gitHubCopilotForAzureExtensionId);
    const hasExtension = !!copilotForAzure;
    const hasSkill = await hasRequiredDeploymentSkills();

    setCorProp(context, 'copilotForAzureExtensionInstalled', hasExtension);
    setCorProp(context, 'copilotForAzureExtensionVersion', (copilotForAzure?.packageJSON as { version?: string } | undefined)?.version ?? 'none');
    setCorProp(context, 'copilotForAzureSkillInstalled', hasSkill);

    const ensurePrereqsOutcomeKey = 'ensureDeploymentPrereqOutcome';
    if (hasExtension && hasSkill) {
        setCorProp(context, ensurePrereqsOutcomeKey, 'alreadyInstalledExtensionAndSkill');
        return true;
    }

    const install = copilotForAzure ? vscode.l10n.t('Install Skills') : vscode.l10n.t('Install');
    const message = copilotForAzure
        ? vscode.l10n.t('Deployment requires Azure skills from GitHub Copilot for Azure. Install them to continue?')
        : vscode.l10n.t('Deployment requires the GitHub Copilot for Azure extension and its Azure skills. Install the extension to continue?');

    const choice = await vscode.window.showWarningMessage(message, { modal: true }, install);
    if (choice !== install) {
        setCorProp(context, ensurePrereqsOutcomeKey, hasExtension ? 'installSkillDeclined' : 'installExtensionDeclined');
        return false;
    }

    let installing = hasExtension ? 'skill' : 'extension';
    try {
        if (!copilotForAzure) {
            await vscode.commands.executeCommand('workbench.extensions.installExtension', gitHubCopilotForAzureExtensionId);
            copilotForAzure = vscode.extensions.getExtension(gitHubCopilotForAzureExtensionId);
        }
        if (!copilotForAzure) {
            throw new Error('GitHub Copilot for Azure was not installed.');
        }
        await copilotForAzure.activate();

        installing = 'skill';
        setCorProp(context, 'pinnedSkillVersion', pinnedAzureSkillsVersion);
        if (!(await hasRequiredDeploymentSkills())) {
            let pinnedSkillsInstalled = false;
            try {
                pinnedSkillsInstalled = await installPinnedAzureDeploymentSkills(copilotForAzure);
                setCorProp(context, 'pinnedSkillInstallOutcome', pinnedSkillsInstalled ? 'succeeded' : 'skillsMissingAfterInstall');
            } catch (error) {
                setCorProp(context, 'pinnedSkillInstallOutcome', 'failed');
                setCorErrorProp(context, 'pinnedSkillInstallError', parseError(error).message);
            }

            if (!pinnedSkillsInstalled) {
                // Fall back to the Copilot for Azure command, which installs the latest skills from `main`.
                await vscode.commands.executeCommand(installAzureSkillsLocallyCommandId);
            }
        }
        if (await hasRequiredDeploymentSkills()) {
            setCorProp(context, ensurePrereqsOutcomeKey, hasExtension ? 'installedSkill' : (hasSkill ? 'installedExtension' : 'installedExtensionAndSkill'));
            return true;
        }
        setCorProp(context, ensurePrereqsOutcomeKey, 'installSkillFailed');
    } catch (error) {
        // The install command rejects when installation is canceled or fails.
        setCorProp(context, ensurePrereqsOutcomeKey, installing === 'extension' ? 'installExtensionFailed' : 'installSkillFailed');
        setCorErrorProp(context, 'ensureDeploymentPrereqError', parseError(error).message);
    }

    void vscode.window.showErrorMessage(
        vscode.l10n.t('GitHub Copilot for Azure and its Azure skills are required to start deployment.'),
    );
    return false;
}
