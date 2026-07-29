/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { copilotOnRailsCommandIds } from '../../../commands/copilotOnRails/registerCopilotOnRailsCommands';
import { azureProjectFocusCommandId } from '../../../constants';

/**
 * Creating a project requires an empty folder. When the user starts the flow in a
 * workspace that already has files, we send them through the folder picker and
 * reopen VS Code on their choice — which tears down the extension host mid-flow.
 * The new window then has to pick the flow back up on its own, but nothing there
 * would activate us: the folder is empty, no command was invoked, and we have no
 * startup activation event.
 *
 * So the hand-off is a file on disk. `workspaceContains:**\/.azure/.pending-create`
 * in package.json which wakes the extension exactly when the create needs to resume.
 * The marker's presence means "resume here". It's deleted on activation so it fires
 * at most once, and carries a timestamp so a stale marker left by an abandoned
 * flow can't resume days later.
 */

/** Workspace-relative path of the marker. Must stay in sync with the `workspaceContains` activation event in package.json. */
export const PENDING_CREATE_SENTINEL_PATH = '.azure/.pending-create';

/**
 * How long a pending create request stays valid. Generous enough to cover a slow
 * window reload, short enough that a marker orphaned by a crash is ignored.
 */
const PENDING_CREATE_TIMEOUT_MS = 10 * 60 * 1000;

interface PendingCreateMarker {
    /** Epoch ms at which the marker was written. */
    createdAt: number;
}

function sentinelUri(folder: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(folder, ...PENDING_CREATE_SENTINEL_PATH.split('/'));
}

/**
 * Records that the user asked to create a project in `folder`, so the flow can
 * resume automatically once VS Code reopens on it. Failures are non-fatal: the
 * user can still start the flow manually from the Azure Project view.
 */
export async function writePendingCreateMarker(folder: vscode.Uri): Promise<void> {
    const marker: PendingCreateMarker = { createdAt: Date.now() };
    try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder, '.azure'));
        await vscode.workspace.fs.writeFile(sentinelUri(folder), Buffer.from(JSON.stringify(marker), 'utf-8'));
    } catch {
        // Best effort only.
    }
}

/**
 * Consumes the pending-create marker in the open workspace, if any. Returns true
 * when a valid, unexpired marker was found, meaning the caller should resume the
 * create flow. The marker (and the `.azure` folder, when we created it solely to
 * hold the marker) is always removed so this fires at most once.
 */
async function consumePendingCreateMarker(): Promise<boolean> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return false;
    }

    for (const folder of folders) {
        const uri = sentinelUri(folder.uri);
        let raw: Uint8Array;
        try {
            raw = await vscode.workspace.fs.readFile(uri);
        } catch {
            continue;
        }

        await deleteMarkerAndEmptyAzureFolder(folder.uri, uri);

        const createdAt = parseCreatedAt(raw);
        if (createdAt !== undefined && Date.now() - createdAt <= PENDING_CREATE_TIMEOUT_MS) {
            return true;
        }
    }

    return false;
}

function parseCreatedAt(raw: Uint8Array): number | undefined {
    try {
        const parsed = JSON.parse(Buffer.from(raw).toString('utf-8')) as Partial<PendingCreateMarker>;
        return typeof parsed.createdAt === 'number' ? parsed.createdAt : undefined;
    } catch {
        return undefined;
    }
}

async function deleteMarkerAndEmptyAzureFolder(folder: vscode.Uri, marker: vscode.Uri): Promise<void> {
    try {
        await vscode.workspace.fs.delete(marker);
    } catch {
        return;
    }

    // Don't leave a stray empty `.azure` folder behind if the marker was all it held.
    const azureFolder = vscode.Uri.joinPath(folder, '.azure');
    try {
        const entries = await vscode.workspace.fs.readDirectory(azureFolder);
        if (entries.length === 0) {
            await vscode.workspace.fs.delete(azureFolder);
        }
    } catch {
        // Best effort only.
    }
}

/**
 * If the user previously pressed "Create with Copilot" and chose a different
 * folder to build in, re-runs the command once VS Code reopens on that folder.
 * Call this during activation. No-ops when there's no pending request or it has
 * expired.
 */
export async function resumePendingCreateWithCopilot(): Promise<void> {
    if (await consumePendingCreateMarker()) {
        // Expand the (collapsed by default) Azure Project view so the resumed
        // flow is visibly picked up in the new window.
        await vscode.commands.executeCommand(azureProjectFocusCommandId);
        await vscode.commands.executeCommand(copilotOnRailsCommandIds.createProjectWithCopilot);
    }
}
