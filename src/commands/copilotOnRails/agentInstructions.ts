/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtFsExtra, IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { CopilotOnRailsContext } from '../../utils/copilotOnRails/CopilotOnRailsContext';
import { setCorProp } from '../../utils/copilotOnRails/telemetryUtils';

export const copilotOnRailsCustomAgents = {
    azureProjectPlanCustomAgent: 'azure-project-plan',
    azureProjectScaffoldCustomAgent: 'azure-project-scaffold',
    azureProjectIntegrateCustomAgent: 'azure-project-integrate',
    azureDebugPlanCustomAgent: 'azure-debug-plan',
    azureDebugGenerateCustomAgent: 'azure-debug-generate',
    azureDeployCustomAgent: 'azure-deploy',
} as const;

/** Folder (relative to the workspace root) where instruction folders are downloaded. */
const WORKSPACE_AGENTS_RELATIVE_PATH = ['.github', 'agents'];

/**
 * Name of the stamp file (written under `.github/agents`) recording the extension
 * version that produced the currently-copied instruction folders. Used to detect
 * stale copies left behind by an older extension version so they can be refreshed.
 */
const VERSION_STAMP_FILE = '.version';

/** Every instruction folder bundled with the extension (under `resources/agents`). */
const agentInstructionFolders: string[] = [
    'azure-debug-generate',
    'azure-debug-plan',
    'azure-project-plan',
    'azure-project-scaffold',
    'azure-project-integrate',
    'azure-deploy',
    'shared-references',
];

/**
 * Hidden marker used to detect whether a markdown file already carries the disclaimer,
 * so re-stamping (e.g. on a version refresh) stays idempotent.
 */
export const disclaimerMarker = '<!-- azure-cor-disclaimer -->';

/** User-facing disclaimer prepended to every downloaded instruction markdown file. */
const disclaimerBlock = `${disclaimerMarker}
> **Important:** This skill provides guidance and recommended instructions to assist the AI system. Outputs are not guaranteed to be complete, correct, secure, or applicable to every scenario. Results should be reviewed and validated by a human before being applied. The AI model may choose not to follow all instructions exactly, and additional verification may be required.
`;

/** The running extension's version, used to stamp copied instruction folders. */
function getExtensionVersion(): string {
    return (ext.context.extension.packageJSON as { version: string }).version;
}

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

/**
 * Inserts the user-facing disclaimer at the top of a markdown document, after YAML front
 * matter when present so the metadata block stays parseable. Idempotent via {@link disclaimerMarker}.
 */
export function applyDisclaimer(content: string): string {
    if (content.includes(disclaimerMarker)) {
        return content;
    }

    const frontMatter = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/.exec(content);
    if (frontMatter) {
        const end = frontMatter[0].length;
        return `${content.slice(0, end)}\n${disclaimerBlock}\n${content.slice(end)}`;
    }

    return `${disclaimerBlock}\n${content}`;
}

/** Recursively stamps the disclaimer into every markdown file under `folder`. */
async function stampDisclaimerIntoMarkdown(folder: vscode.Uri): Promise<void> {
    for (const [name, type] of await vscode.workspace.fs.readDirectory(folder)) {
        const entry = vscode.Uri.joinPath(folder, name);
        if ((type & vscode.FileType.Directory) !== 0) {
            await stampDisclaimerIntoMarkdown(entry);
        } else if ((type & vscode.FileType.File) !== 0 && name.toLowerCase().endsWith('.md')) {
            const original = await AzExtFsExtra.readFile(entry);
            const stamped = applyDisclaimer(original);
            if (stamped !== original) {
                await AzExtFsExtra.writeFile(entry, stamped);
            }
        }
    }
}

/** Copies each of the given instruction folders from the extension bundle into the workspace, replacing any existing copies. */
async function copyInstructionFolders(folders: string[], agentsRoot: vscode.Uri): Promise<void> {
    const bundledRoot = getBundledAgentsRoot();
    for (const folder of folders) {
        const source = vscode.Uri.joinPath(bundledRoot, folder);
        const dest = vscode.Uri.joinPath(agentsRoot, folder);
        await AzExtFsExtra.copy(source, dest, { overwrite: true });
        await stampDisclaimerIntoMarkdown(dest);
    }
}

/** Reads the version stamp written next to the copied instruction folders, or `undefined` when absent/unreadable. */
async function readVersionStamp(agentsRoot: vscode.Uri): Promise<string | undefined> {
    const stampUri = vscode.Uri.joinPath(agentsRoot, VERSION_STAMP_FILE);
    if (!(await AzExtFsExtra.pathExists(stampUri))) {
        return undefined;
    }
    try {
        return (await AzExtFsExtra.readFile(stampUri)).trim();
    } catch {
        return undefined;
    }
}

/** Writes the running extension's version into the stamp file next to the copied instruction folders. */
async function writeVersionStamp(agentsRoot: vscode.Uri): Promise<void> {
    const stampUri = vscode.Uri.joinPath(agentsRoot, VERSION_STAMP_FILE);
    await AzExtFsExtra.writeFile(stampUri, getExtensionVersion());
}

/**
 * Ensures the bundled instruction files are present — and up to date — in the workspace
 * before an agent is invoked.
 *
 * - When any folder is missing, the user is asked whether to download them. Declining
 *   returns `false` so the caller can abort the agent invocation.
 * - When every folder is present but the version stamp is missing or does not match the
 *   running extension version, the folders are refreshed silently so a stale copy left by
 *   an older extension version can't make the agent follow outdated instructions.
 * - When all folders are present and the stamp matches, returns `true` immediately without
 *   any prompts or copies.
 *
 * No-ops (returns `true`) when no workspace is open.
 */
export async function ensureAgentInstructions(context: CopilotOnRailsContext, agentName: string): Promise<boolean> {
    const ensureAgentInstructionsOutcomeKey = 'ensureAgentInstructionsOutcome';
    const agentsRoot = getWorkspaceAgentsRoot();
    if (!agentsRoot) {
        setCorProp(context, ensureAgentInstructionsOutcomeKey, 'noWorkspace');
        return true;
    }

    const missingFolders: string[] = [];
    for (const folder of agentInstructionFolders) {
        if (!(await AzExtFsExtra.pathExists(vscode.Uri.joinPath(agentsRoot, folder)))) {
            missingFolders.push(folder);
        }
    }
    setCorProp(context, 'agentInstructionsMissingCount', missingFolders.length);
    setCorProp(context, 'agentInstructionsMissingFolders', missingFolders.join(','));

    if (missingFolders.length === 0) {
        // Todo: Come up with a more robust update system
        // All folders present — refresh silently if they were written by a different
        // extension version (stale instructions are a silent correctness hazard).
        if ((await readVersionStamp(agentsRoot)) !== getExtensionVersion()) {
            await copyInstructionFolders(agentInstructionFolders, agentsRoot);
            await writeVersionStamp(agentsRoot);
            setCorProp(context, ensureAgentInstructionsOutcomeKey, 'refreshedStale');
            return true;
        }
        setCorProp(context, ensureAgentInstructionsOutcomeKey, 'upToDate');
        return true;
    }

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
        setCorProp(context, ensureAgentInstructionsOutcomeKey, 'downloadDeclined');
        return false;
    }

    // A folder was missing — bring everything to the current version, not just the
    // missing folders, so present-but-stale folders are refreshed at the same time.
    await copyInstructionFolders(agentInstructionFolders, agentsRoot);
    await writeVersionStamp(agentsRoot);
    setCorProp(context, ensureAgentInstructionsOutcomeKey, 'downloaded');
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
    await writeVersionStamp(agentsRoot);
    void vscode.window.showInformationMessage(vscode.l10n.t('Azure agent instructions downloaded to ".github/agents".'));
}
