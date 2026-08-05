/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { gitHubCopilotForAzureExtensionId } from '../../constants';
import { CopilotOnRailsContext } from '../../utils/copilotOnRails/CopilotOnRailsContext';
import { setCorErrorProp, setCorProp } from '../../utils/copilotOnRails/telemetryUtils';

const azurePrepareSkillName = 'azure-prepare';
const skillFileName = 'SKILL.md';
const installAzureSkillsLocallyCommandId = '@azure.installAzureSkillsLocally';

/**
 * The deploy-stage skills whose versions we record in telemetry on every deploy-stage run.
 * These are installed into the workspace `.agents/skills/<skill>/` by the local skills install
 * (command {@link installAzureSkillsLocallyCommandId}, owned by the GitHub Copilot for Azure extension).
 */
export const deploySkillNames = ['azure-prepare', 'azure-validate', 'azure-deploy'] as const;

/** Telemetry value recorded for a deploy skill whose version can't be resolved. */
export const unknownSkillVersion = 'unknown';

async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return (stat.type & vscode.FileType.File) !== 0;
    } catch {
        return false;
    }
}

/**
 * The `.agents` roots inside the user's workspace. Intentionally does NOT include the global
 * `~/.agents` location: the deploy gate guarantees a *workspace* copy of the deploy skills, so a
 * global copy must not short-circuit the local install.
 */
export function getWorkspaceAgentsRoots(): vscode.Uri[] {
    return vscode.workspace.workspaceFolders?.map(folder => vscode.Uri.joinPath(folder.uri, '.agents')) ?? [];
}

/** Uri of a skill's `SKILL.md` under a given `.agents` root. */
function skillMarkdownUri(agentsRoot: vscode.Uri, skillName: string): vscode.Uri {
    return vscode.Uri.joinPath(agentsRoot, 'skills', skillName, skillFileName);
}

/** Returns the first `.agents` root (among the given roots) that contains the skill's `SKILL.md`, or `undefined`. */
async function findSkillMarkdown(roots: vscode.Uri[], skillName: string): Promise<vscode.Uri | undefined> {
    for (const root of roots) {
        const uri = skillMarkdownUri(root, skillName);
        if (await fileExists(uri)) {
            return uri;
        }
    }
    return undefined;
}

/** Whether the given skill's `SKILL.md` exists under any of the given `.agents` roots. */
export async function skillExistsInRoots(roots: vscode.Uri[], skillName: string): Promise<boolean> {
    return (await findSkillMarkdown(roots, skillName)) !== undefined;
}

/**
 * Reads `metadata.version` from a skill's `SKILL.md` YAML frontmatter.
 *
 * The frontmatter looks like:
 * ```yaml
 * ---
 * name: azure-prepare
 * metadata:
 *   author: Microsoft
 *   version: "1.3.1"
 * ---
 * ```
 *
 * Returns the semver string (quotes stripped), or `undefined` when there is no frontmatter, no
 * `metadata` block, or no `version` inside it. A top-level `version:` outside the `metadata` block
 * is deliberately ignored - only the per-skill `metadata.version` counts.
 */
export function parseSkillMetadataVersion(content: string): string | undefined {
    const frontmatterMatch = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    if (!frontmatterMatch) {
        return undefined;
    }

    const lines = frontmatterMatch[1].split(/\r?\n/);
    let metadataIndent: number | undefined;
    for (const line of lines) {
        if (line.trim() === '') {
            continue;
        }

        const metadataMatch = /^(\s*)metadata\s*:\s*$/.exec(line);
        if (metadataMatch) {
            metadataIndent = metadataMatch[1].length;
            continue;
        }

        if (metadataIndent !== undefined) {
            const indent = line.length - line.trimStart().length;
            if (indent <= metadataIndent) {
                // Dedented back out of the `metadata:` block without finding a version.
                metadataIndent = undefined;
                continue;
            }
            const versionMatch = /^\s*version\s*:\s*(.+)$/.exec(line);
            if (versionMatch) {
                const version = stripYamlScalarQuotes(versionMatch[1]);
                return version.length > 0 ? version : undefined;
            }
        }
    }
    return undefined;
}

/** Strips a single pair of surrounding single/double quotes from a YAML scalar and trims it. */
function stripYamlScalarQuotes(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length >= 2) {
        const first = trimmed[0];
        const last = trimmed[trimmed.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return trimmed.slice(1, -1).trim();
        }
    }
    return trimmed;
}

/**
 * Resolves a deploy skill's semver from its workspace `SKILL.md` `metadata.version`, or `undefined`
 * when the skill isn't installed in the workspace or its version can't be parsed. Never throws.
 */
export async function readWorkspaceSkillVersion(roots: vscode.Uri[], skillName: string): Promise<string | undefined> {
    const uri = await findSkillMarkdown(roots, skillName);
    if (!uri) {
        return undefined;
    }
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        return parseSkillMetadataVersion(Buffer.from(bytes).toString('utf8'));
    } catch {
        return undefined;
    }
}

/** Telemetry property key for a deploy skill's version, e.g. `azure-prepare` -> `azurePrepareSkillVersion`. */
export function deploySkillVersionTelemetryKey(skillName: string): string {
    const camel = skillName.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    return `${camel}SkillVersion`;
}

/** Whether the `azure-prepare` skill has a workspace copy (global `~/.agents` copies do not count). */
async function hasAzurePrepareSkillInWorkspace(): Promise<boolean> {
    return skillExistsInRoots(getWorkspaceAgentsRoots(), azurePrepareSkillName);
}

/**
 * Records the resolved semver of each deploy skill (`azure-prepare`, `azure-validate`, `azure-deploy`)
 * read from its workspace `SKILL.md` `metadata.version`. Missing/unreadable versions are recorded as
 * {@link unknownSkillVersion}. Never throws, so it can safely run on every deploy-stage run without
 * risking the gate.
 */
async function recordDeploySkillVersions(context: CopilotOnRailsContext): Promise<void> {
    const roots = getWorkspaceAgentsRoots();
    for (const skillName of deploySkillNames) {
        let version: string | undefined;
        try {
            version = await readWorkspaceSkillVersion(roots, skillName);
        } catch {
            version = undefined;
        }
        setCorProp(context, deploySkillVersionTelemetryKey(skillName), version ?? unknownSkillVersion);
    }
}

export async function ensureAzureDeploymentPrerequisites(context: CopilotOnRailsContext): Promise<boolean> {
    try {
        return await ensureAzureDeploymentPrerequisitesCore(context);
    } finally {
        // Record the deploy skills' versions on every run, reflecting the workspace state after any
        // install above. Guarded so telemetry recording can never crash the gate.
        await recordDeploySkillVersions(context);
    }
}

async function ensureAzureDeploymentPrerequisitesCore(context: CopilotOnRailsContext): Promise<boolean> {
    let copilotForAzure = vscode.extensions.getExtension(gitHubCopilotForAzureExtensionId);
    const hasExtension = !!copilotForAzure;
    // Key the "already installed" check off the *workspace* copy only: a global `~/.agents` copy must
    // not short-circuit the local install, since the deploy gate guarantees a workspace copy.
    const hasSkill = await hasAzurePrepareSkillInWorkspace();

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
        // Only run the local skills install when the workspace copy is missing - don't force-refresh
        // or re-download when a local copy already exists.
        if (!(await hasAzurePrepareSkillInWorkspace())) {
            await vscode.commands.executeCommand(installAzureSkillsLocallyCommandId);
        }
        if (await hasAzurePrepareSkillInWorkspace()) {
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
