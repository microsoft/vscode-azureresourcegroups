/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { copilotOnRailsCommandIds } from '../../../commands/copilotOnRails/registerCopilotOnRailsCommands';
import { azureProjectFocusCommandId } from '../../../constants';
import { corId, getCorProjectId, reportCorBackgroundEvent, restoreCorProjectId } from '../../../utils/copilotOnRails/telemetryUtils';
import { type CorWorkflowHandoff, getCorWorkflowHandoff, parseCorWorkflowHandoff, restoreCorWorkflowHandoff } from '../../../utils/copilotOnRails/workflowContext';
import { isJsonObject } from '../shared/jsonUtils';

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

const PENDING_CREATE_TIMEOUT_MS = 10 * 60 * 1000;

export interface PendingCreateMarker {
    /** Epoch ms at which the marker was written. */
    createdAt: number;
    /** Random project correlation id. Contains no user or Azure identity. */
    projectId?: string;
    /** Minimal workflow identity needed to continue in the new workspace. */
    workflow?: CorWorkflowHandoff;
}

function sentinelUri(folder: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(folder, ...PENDING_CREATE_SENTINEL_PATH.split('/'));
}

export async function writePendingCreateMarker(folder: vscode.Uri): Promise<void> {
    const marker: PendingCreateMarker = {
        createdAt: Date.now(),
        projectId: getCorProjectId(),
        workflow: getCorWorkflowHandoff(),
    };
    try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder, '.azure'));
        await vscode.workspace.fs.writeFile(sentinelUri(folder), Buffer.from(JSON.stringify(marker), 'utf-8'));
    } catch {
        // Best effort only.
    }
}

async function consumePendingCreateMarker(): Promise<PendingCreateMarker | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return undefined;
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

        const marker = parsePendingCreateMarker(raw);
        if (marker) {
            return marker;
        }
    }

    return undefined;
}

export function parsePendingCreateMarker(raw: Uint8Array, now: number = Date.now()): PendingCreateMarker | undefined {
    try {
        const parsed: unknown = JSON.parse(Buffer.from(raw).toString('utf-8'));
        if (!isJsonObject(parsed)) {
            return undefined;
        }

        if (typeof parsed.createdAt !== 'number'
            || !Number.isFinite(parsed.createdAt)
            || parsed.createdAt < 0
            || parsed.createdAt > now + 60_000
            || now - parsed.createdAt > PENDING_CREATE_TIMEOUT_MS) {
            return undefined;
        }

        const projectId = typeof parsed.projectId === 'string'
            && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.projectId)
            ? parsed.projectId
            : undefined;
        const workflow = parseCorWorkflowHandoff(parsed.workflow);
        if (parsed.workflow !== undefined && !workflow) {
            return undefined;
        }
        return {
            createdAt: parsed.createdAt,
            ...(projectId ? { projectId } : {}),
            ...(workflow ? { workflow } : {}),
        };
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
        // Best effort attempt
    }
}

/**
 * If the user previously pressed "Create with Copilot" and chose a different
 * folder to build in, re-runs the command once VS Code reopens on that folder.
 * Call this during activation. No-ops when there's no pending request or it has
 * expired.
 */
export async function resumePendingCreateWithCopilot(): Promise<void> {
    const marker = await consumePendingCreateMarker();
    if (!marker) {
        return;
    }
    if (marker.projectId) {
        await restoreCorProjectId(marker.projectId);
    }
    if (marker.workflow) {
        await restoreCorWorkflowHandoff(marker.workflow);
    }
    await reportCorBackgroundEvent(corId('folderHandoffResumed'), { handoffIdentityRestored: !!marker.workflow });
    await vscode.commands.executeCommand(azureProjectFocusCommandId);
    await vscode.commands.executeCommand(copilotOnRailsCommandIds.createProjectWithCopilot, 'folderHandoff');
}
