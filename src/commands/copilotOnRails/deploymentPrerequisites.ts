/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError } from '@microsoft/vscode-azext-utils';
import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { gitHubCopilotForAzureExtensionId } from '../../constants';
import { CopilotOnRailsContext } from '../../utils/copilotOnRails/CopilotOnRailsContext';
import { setCorErrorProp, setCorProp } from '../../utils/copilotOnRails/telemetryUtils';
import { cliVersionForTelemetry, detectCliVersions } from './deploymentCliPrerequisites';

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

export async function ensureAzureDeploymentPrerequisites(context: CopilotOnRailsContext): Promise<boolean> {
    await recordDetectedCliVersions(context);

    let copilotForAzure = vscode.extensions.getExtension(gitHubCopilotForAzureExtensionId);
    const hasExtension = !!copilotForAzure;
    const hasSkill = await hasAzurePrepareSkill();

    setCorProp(context, 'copilotForAzureExtensionInstalled', hasExtension);
    setCorProp(context, 'copilotForAzureExtensionVersion', (copilotForAzure?.packageJSON as { version?: string } | undefined)?.version ?? 'none');
    setCorProp(context, 'copilotForAzureSkillInstalled', hasSkill);

    const ensurePrereqsOutcomeKey = 'ensureDeploymentPrereqOutcome';
    if (hasExtension && hasSkill) {
        setCorProp(context, ensurePrereqsOutcomeKey, 'alreadyInstalledExtensionAndSkill');
        return true;
    }

    const install = copilotForAzure ? vscode.l10n.t('Install Skill') : vscode.l10n.t('Install');
    const message = copilotForAzure
        ? vscode.l10n.t('Deployment requires the "{0}" skill from GitHub Copilot for Azure. Install the skill to continue?', azurePrepareSkillName)
        : vscode.l10n.t('Deployment requires the GitHub Copilot for Azure extension and its "{0}" skill. Install the extension to continue?', azurePrepareSkillName);

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
        if (!(await hasAzurePrepareSkill())) {
            await vscode.commands.executeCommand(installAzureSkillsLocallyCommandId);
        }
        if (await hasAzurePrepareSkill()) {
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
        vscode.l10n.t('GitHub Copilot for Azure with the "{0}" skill is required to start deployment.', azurePrepareSkillName),
    );
    return false;
}

/**
 * Always record the detected `azd` + `az` CLI versions on the run (D6). This is
 * best-effort telemetry only - detection never throws, and an unconfirmable CLI
 * records as a clearly-empty value rather than blocking the gate.
 */
async function recordDetectedCliVersions(context: CopilotOnRailsContext): Promise<void> {
    try {
        const versions = await detectCliVersions();
        setCorProp(context, 'deployCliAzdVersion', cliVersionForTelemetry(versions.azd));
        setCorProp(context, 'deployCliAzVersion', cliVersionForTelemetry(versions.az));
    } catch (error) {
        setCorErrorProp(context, 'deployCliDetectionError', parseError(error).message);
    }
}
