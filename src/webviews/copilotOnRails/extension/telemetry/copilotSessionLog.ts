/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as vscode from "vscode";
import { ext } from "../../../../extensionVariables";

/**
 * Best-effort traceability from a create-project diagnostics run back to the VS
 * Code Copilot chat session logs that drove it.
 *
 * These logs are owned and written by the Copilot Chat extension, not by us; we
 * only *locate* them so a report can point the user at the right files. Nothing
 * here reads log contents or transmits anything — only local filesystem paths
 * are surfaced, and only into the local-only Markdown report.
 */

/** Extension id (publisher.name) whose workspace-storage folder holds the chat debug logs. */
const COPILOT_CHAT_EXTENSION_ID = 'GitHub.copilot-chat';

/** Sub-folder under the chat extension's workspace storage where per-session logs live. */
const DEBUG_LOGS_DIRNAME = 'debug-logs';

/** Cap on how many session log entries a single report links to. */
const MAX_SESSIONS = 10;

/**
 * Slack applied to the run's [startedAt, endedAt] window when matching log
 * mtimes, so a session whose log was flushed just before the first phase began
 * or just after the run ended is still captured.
 */
const WINDOW_SLACK_MS = 60_000;

export interface CopilotChatSessions {
    /** Directory the Copilot Chat extension writes per-session debug logs to. */
    debugLogsDir: vscode.Uri;
    /**
     * Session log entries (files or folders) whose mtime falls within the run's
     * time window, newest first. May be empty when logging is off or no session
     * overlapped the run.
     */
    sessions: vscode.Uri[];
}

/**
 * Resolves the Copilot Chat `debug-logs` directory for the current workspace.
 *
 * This extension's own workspace storage lives at
 * `…/workspaceStorage/<hash>/<thisExtensionId>`, so its parent — the shared
 * `…/workspaceStorage/<hash>` folder — is also where the Copilot Chat extension
 * keeps `GitHub.copilot-chat/debug-logs`. Returns `undefined` when no workspace
 * is open (no `storageUri`).
 */
function resolveDebugLogsDir(): vscode.Uri | undefined {
    const storageUri = ext.context.storageUri;
    if (!storageUri) {
        return undefined;
    }
    const workspaceStorageDir = vscode.Uri.file(path.dirname(storageUri.fsPath));
    return vscode.Uri.joinPath(workspaceStorageDir, COPILOT_CHAT_EXTENSION_ID, DEBUG_LOGS_DIRNAME);
}

async function statSafe(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
    try {
        return await vscode.workspace.fs.stat(uri);
    } catch {
        return undefined;
    }
}

/**
 * Discovers the Copilot chat session logs active during a run's
 * `[startedAt, endedAt]` window (widened by {@link WINDOW_SLACK_MS}). A single
 * run spans several fresh chat sessions — one per phase hand-off — so we match
 * by time window rather than a single session id, capturing all of them.
 *
 * Returns `undefined` when the log directory can't be located or doesn't exist
 * (e.g. no workspace, or Copilot chat logging never wrote anything). Best
 * effort: any filesystem error yields a partial (possibly empty) result.
 */
export async function collectCopilotChatSessions(startedAt: number, endedAt: number): Promise<CopilotChatSessions | undefined> {
    const debugLogsDir = resolveDebugLogsDir();
    if (!debugLogsDir || !(await statSafe(debugLogsDir))) {
        return undefined;
    }

    let entries: [string, vscode.FileType][];
    try {
        entries = await vscode.workspace.fs.readDirectory(debugLogsDir);
    } catch {
        return { debugLogsDir, sessions: [] };
    }

    const from = startedAt - WINDOW_SLACK_MS;
    const to = endedAt + WINDOW_SLACK_MS;
    const matched: { uri: vscode.Uri; mtime: number }[] = [];
    for (const [name] of entries) {
        const uri = vscode.Uri.joinPath(debugLogsDir, name);
        const stat = await statSafe(uri);
        if (stat && stat.mtime >= from && stat.mtime <= to) {
            matched.push({ uri, mtime: stat.mtime });
        }
    }

    matched.sort((a, b) => b.mtime - a.mtime);
    return { debugLogsDir, sessions: matched.slice(0, MAX_SESSIONS).map((m) => m.uri) };
}
