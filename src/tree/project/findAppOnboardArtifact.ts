/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { isJsonObject } from '../../webviews/copilotOnRails/shared/jsonUtils';
import { APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, DEPLOY_RESULT_FILE_GLOBS, findProjectFiles, PREPARE_PLAN_FILE_GLOBS } from './projectPlanFiles';

/**
 * Prefer the active session's artifact, then its verified root fallback. Only recover by mtime
 * when the pointer is missing, invalid, or names a removed session. An existing active session
 * with no artifact yet must not surface a different session's plan.
 */
export async function findAppOnboardArtifact(fileName: 'prepare-plan.json' | 'deploy-result.json', folder?: vscode.WorkspaceFolder): Promise<vscode.Uri | undefined> {
    const globs = fileName === 'prepare-plan.json' ? PREPARE_PLAN_FILE_GLOBS : DEPLOY_RESULT_FILE_GLOBS;
    const recovery: { uri: vscode.Uri; mtime: number }[] = [];
    let activeSessionPending = false;

    for (const workspaceFolder of folder ? [folder] : vscode.workspace.workspaceFolders ?? []) {
        const matches = (await Promise.all(globs.map(glob => findProjectFiles(glob, workspaceFolder)))).flat();
        const pointer = vscode.Uri.joinPath(workspaceFolder.uri, APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB);
        const parsed = await readJson(pointer);
        const sessionId = isJsonObject(parsed) && typeof parsed.activeSessionId === 'string'
            && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(parsed.activeSessionId)
            ? parsed.activeSessionId
            : undefined;

        if (sessionId) {
            const directory = vscode.Uri.joinPath(pointer, '..', sessionId);
            const expected = vscode.Uri.joinPath(directory, fileName).toString();
            const active = matches.find(uri => uri.toString() === expected);
            if (active) {
                return active;
            }

            const root = vscode.Uri.joinPath(workspaceFolder.uri, globs[0]);
            if (matches.some(uri => uri.toString() === root.toString()) && artifactSessionId(await readJson(root)) === sessionId) {
                return root;
            }

            if (((await statIfPresent(directory))?.type ?? 0) & vscode.FileType.Directory) {
                activeSessionPending = true;
                continue;
            }
        }

        for (const uri of matches) {
            const stat = await statIfPresent(uri);
            if (stat) {
                recovery.push({ uri, mtime: stat.mtime });
            }
        }
    }

    if (activeSessionPending) {
        return undefined;
    }
    recovery.sort((a, b) => b.mtime - a.mtime || a.uri.toString().localeCompare(b.uri.toString()));
    return recovery[0]?.uri;
}

function artifactSessionId(value: unknown): string | undefined {
    if (!isJsonObject(value)) {
        return undefined;
    }
    // PreparePlan stores the identity in deploymentVariables; DeployResult uses sessionId.
    const sessionId = isJsonObject(value.deploymentVariables) ? value.deploymentVariables.sessionId : value.sessionId;
    return typeof sessionId === 'string' ? sessionId : undefined;
}

async function statIfPresent(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
    try {
        return await vscode.workspace.fs.stat(uri);
    } catch (error) {
        if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
            return undefined;
        }
        throw error;
    }
}

async function readJson(uri: vscode.Uri): Promise<unknown> {
    try {
        const parsed: unknown = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8'));
        return parsed;
    } catch (error) {
        if (error instanceof SyntaxError || (error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) {
            return undefined;
        }
        throw error;
    }
}
