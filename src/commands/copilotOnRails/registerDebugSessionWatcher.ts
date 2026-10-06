/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ProjectPlanFilesWatcher, isCopilotOnRailsProjectFolder } from '../../tree/project/projectPlanFiles';
import { corId, getCorProjectId } from '../../utils/copilotOnRails/telemetryUtils';

/**
 * Bookkeeping for a single in-flight debug session that belongs to a Copilot on
 * Rails project. Created when the session is first observed and removed when it
 * terminates.
 */
interface TrackedDebugSession {
    /** `Date.now()` when the session was first observed, for duration reporting. */
    readonly startedAt: number;
    /** The debug type (e.g. `node`, `python`, `chrome`). Never `compound` — see {@link registerDebugSessionWatcher}. */
    readonly sessionType: string;
    /** True when the session was spawned by another session (an adapter-created child), not a top-level launch. */
    readonly isChildSession: boolean;
    /** Exit code reported by the debuggee via the DAP `exited` event, if one was sent. */
    exitCode?: number;
    /** True when the debug adapter itself errored or exited with a non-zero code. */
    adapterFailed?: boolean;
}

/** Minimal shape of the Debug Adapter Protocol messages we inspect. */
interface DebugProtocolMessage {
    type?: string;
    event?: string;
    body?: { exitCode?: number };
}

/** In-flight CoR debug sessions, keyed by `DebugSession.id`. */
const trackedSessions = new Map<string, TrackedDebugSession>();

/** Folder URIs (as strings) known to be Copilot on Rails projects, so the session hooks can decide synchronously. */
const corProjectFolders = new Set<string>();

/**
 * Watches debug session start/terminate and reports lightweight telemetry, but
 * only for sessions that run inside a Copilot on Rails project folder.
 *
 * Compound configurations: VS Code does not create a session for the compound
 * itself — it starts each referenced configuration as its own independent,
 * sibling session (they do not share a `parentSession`). Launching one compound
 * is therefore observed here as several start/terminate pairs, one per child
 * configuration, running concurrently. Adapter-created child sessions (e.g. the
 * JS debugger's worker sessions) do set `parentSession`; those are flagged via
 * `isChildSession` so they can be told apart from top-level launches.
 */
export function registerDebugSessionWatcher(context: vscode.ExtensionContext, planFilesWatcher: ProjectPlanFilesWatcher): void {
    context.subscriptions.push(
        planFilesWatcher.onDidChange(() => void refreshCorProjectFolders()),
        vscode.debug.onDidStartDebugSession((session) => void onDidStartDebugSession(session)),
        vscode.debug.onDidTerminateDebugSession((session) => onDidTerminateDebugSession(session)),
        vscode.debug.registerDebugAdapterTrackerFactory('*', {
            createDebugAdapterTracker: (session) => createTracker(session),
        }),
    );

    void refreshCorProjectFolders();
}

/** Recomputes which workspace folders are Copilot on Rails projects. */
async function refreshCorProjectFolders(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const memberships = await Promise.all(
        folders.map(async (folder) => ({ key: folder.uri.toString(), isCor: await isCopilotOnRailsProjectFolder(folder) })),
    );

    corProjectFolders.clear();
    for (const { key, isCor } of memberships) {
        if (isCor) {
            corProjectFolders.add(key);
        }
    }
}

function isCorSession(session: vscode.DebugSession): boolean {
    const folder = session.workspaceFolder;
    return folder !== undefined && corProjectFolders.has(folder.uri.toString());
}

/**
 * Returns the tracking record for a CoR session, creating it on first sight.
 * Returns `undefined` for sessions that don't belong to a CoR project.
 */
function ensureTracked(session: vscode.DebugSession): TrackedDebugSession | undefined {
    const existing = trackedSessions.get(session.id);
    if (existing) {
        return existing;
    }
    if (!isCorSession(session)) {
        return undefined;
    }

    const tracked: TrackedDebugSession = {
        startedAt: Date.now(),
        sessionType: session.type,
        isChildSession: session.parentSession !== undefined,
    };
    trackedSessions.set(session.id, tracked);
    return tracked;
}

async function onDidStartDebugSession(session: vscode.DebugSession): Promise<void> {
    let tracked = ensureTracked(session);
    if (!tracked) {
        // The folder cache may not be populated yet in the first moments after activation;
        // fall back to a one-off async check so a fast launch isn't missed.
        const folder = session.workspaceFolder;
        if (folder && await isCopilotOnRailsProjectFolder(folder)) {
            corProjectFolders.add(folder.uri.toString());
            tracked = ensureTracked(session);
        }
    }

    if (!tracked) {
        return;
    }

    reportDebugSessionEvent(corId('debugSessionStart'), {
        sessionType: tracked.sessionType,
        isChildSession: String(tracked.isChildSession),
    });
}

function onDidTerminateDebugSession(session: vscode.DebugSession): void {
    const tracked = trackedSessions.get(session.id);
    if (!tracked) {
        return;
    }
    trackedSessions.delete(session.id);

    reportDebugSessionEvent(corId('debugSessionEnd'), {
        sessionType: tracked.sessionType,
        isChildSession: String(tracked.isChildSession),
        outcome: computeOutcome(tracked),
        exitCode: tracked.exitCode !== undefined ? String(tracked.exitCode) : 'none',
    }, {
        durationInSeconds: (Date.now() - tracked.startedAt) / 1000,
    });
}

/**
 * Observes DAP traffic for a tracked session so we can capture the debuggee's
 * exit code and distinguish a clean finish from a failure. Returns `undefined`
 * for non-CoR sessions so no tracker is attached to unrelated debugging.
 */
function createTracker(session: vscode.DebugSession): vscode.DebugAdapterTracker | undefined {
    const tracked = ensureTracked(session);
    if (!tracked) {
        return undefined;
    }

    return {
        onDidSendMessage(message: DebugProtocolMessage): void {
            if (message.type === 'event' && message.event === 'exited' && typeof message.body?.exitCode === 'number') {
                tracked.exitCode = message.body.exitCode;
            }
        },
        onError(): void {
            tracked.adapterFailed = true;
        },
        onExit(code: number | undefined): void {
            if (code !== undefined && code !== 0) {
                tracked.adapterFailed = true;
            }
        },
    };
}

/**
 * Classifies how a session ended. A missing exit code usually means the user
 * stopped debugging (or the adapter never reported one), which is deliberately
 * not treated as a failure.
 */
function computeOutcome(tracked: TrackedDebugSession): 'succeeded' | 'failed' | 'cancelledOrUnknown' {
    if (tracked.adapterFailed || (tracked.exitCode !== undefined && tracked.exitCode !== 0)) {
        return 'failed';
    }
    if (tracked.exitCode === 0) {
        return 'succeeded';
    }
    return 'cancelledOrUnknown';
}

function reportDebugSessionEvent(eventName: string, properties: Record<string, string>, measurements?: Record<string, number>): void {
    void callWithTelemetryAndErrorHandling(eventName, async (context: IActionContext) => {
        context.telemetry.properties.isCopilotEvent = 'true';
        context.telemetry.properties.corProjectId = getCorProjectId();
        Object.assign(context.telemetry.properties, properties);
        if (measurements) {
            Object.assign(context.telemetry.measurements, measurements);
        }
    });
}
