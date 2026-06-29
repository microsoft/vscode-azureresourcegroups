/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtFsExtra } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";

/**
 * Autopilot ("YOLO") mode for the create-project workflow.
 *
 * When the user submits the requirements form with autopilot enabled, the whole
 * plan -> scaffold -> local-debug chain runs end-to-end without approval gates.
 * To make tool actions (file edits, terminal commands) run unattended, we flip
 * VS Code's global `chat.tools.global.autoApprove` setting on for the duration
 * of the run and restore it afterward. We also raise `chat.agent.maxRequests`
 * to a high ceiling so the long scaffold -> integrate -> debug chain doesn't
 * stall on the "Copilot has been working on this problem for a while" continue
 * prompt — but unlike auto-approve, that limit is written at the *Workspace*
 * scope and intentionally left in place (it isn't a security-sensitive global,
 * and a freshly scaffolded workspace benefits from the higher ceiling).
 *
 * Because the auto-approve setting is global and security-sensitive, its
 * restoration is layered:
 *  1. A completion watcher restores it the moment the local debug plan reaches
 *     `Status: Implemented` (the end of the chain).
 *  2. A safety deadline restores it after `MAX_RUN_DURATION_MS` even if the
 *     chain never reaches `Implemented` (failure, stall, or abandoned run), so
 *     auto-approve can never stay on indefinitely.
 *  3. A status-bar item lets the user turn it off manually at any time.
 *  4. On the next activation, a prior active run is either re-armed (if still
 *     within its deadline — covers window reloads mid-run) or restored (if the
 *     deadline has elapsed — covers crashes / abandoned runs).
 */

const AUTO_APPROVE_SECTION = 'chat.tools.global';
const AUTO_APPROVE_KEY = 'autoApprove';

const MAX_REQUESTS_SECTION = 'chat.agent';
const MAX_REQUESTS_KEY = 'maxRequests';

/**
 * Request budget written to `chat.agent.maxRequests` at the Workspace scope while
 * scaffolding. The unattended chain (scaffold -> integrate -> local debug) makes
 * many tool calls per turn; a high ceiling keeps it from pausing on the "Copilot
 * has been working on this problem for a while" continue prompt that nobody is
 * present to dismiss. Persisted in the workspace and intentionally not restored.
 */
export const WORKSPACE_MAX_REQUESTS = 9999;

/**
 * Maximum wall-clock duration an autopilot run may keep global auto-approve on.
 * After this elapses the setting is restored even if the chain never completed,
 * so a failed/stalled/abandoned run can't leave auto-approve on forever.
 */
const MAX_RUN_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Marker embedded in the chat query so agents can detect an autopilot run. */
export const AUTOPILOT_QUERY_MARKER = '[AUTOPILOT MODE]';

/** Glob for the local debug plan whose completion ends an autopilot run. */
export const DEBUG_PLAN_GLOB = '.azure/vscode-debug-plan.md';

/** globalState keys used to survive window reloads mid-run. */
const STATE_ACTIVE = 'azureResourceGroups.autopilot.active';
const STATE_PRIOR_VALUE = 'azureResourceGroups.autopilot.priorAutoApprove';
/** Epoch ms after which an active run is considered stale and auto-restored. */
const STATE_DEADLINE = 'azureResourceGroups.autopilot.deadline';

/** Command id used by the status-bar item to turn autopilot off. */
export const DISABLE_AUTOPILOT_COMMAND = 'azureResourceGroups.disableAutopilot';

let statusBarItem: vscode.StatusBarItem | undefined;
let completionWatcher: vscode.FileSystemWatcher | undefined;
let safetyTimer: ReturnType<typeof setTimeout> | undefined;
let extensionContext: vscode.ExtensionContext | undefined;

function getAutoApproveValue(): unknown {
    const config = vscode.workspace.getConfiguration(AUTO_APPROVE_SECTION);
    const inspected = config.inspect(AUTO_APPROVE_KEY);
    // We only ever write at the Global target, so the global value is what we
    // need to preserve and restore.
    return inspected?.globalValue;
}

async function setAutoApproveValue(value: unknown): Promise<void> {
    const config = vscode.workspace.getConfiguration(AUTO_APPROVE_SECTION);
    await config.update(AUTO_APPROVE_KEY, value, vscode.ConfigurationTarget.Global);
}

/**
 * Reads the effective (merged) `chat.agent.maxRequests` value, or undefined if unset.
 */
export function getEffectiveMaxRequests(): number | undefined {
    return vscode.workspace.getConfiguration(MAX_REQUESTS_SECTION).get<number>(MAX_REQUESTS_KEY);
}

/**
 * Raises `chat.agent.maxRequests` to {@link WORKSPACE_MAX_REQUESTS} at the Workspace
 * scope so the unattended scaffold -> integrate -> debug chain doesn't stall on the
 * "Copilot has been working on this problem for a while" continue prompt. The value
 * is persisted in the workspace and intentionally never restored. No-op when no
 * workspace folder is open (a workspace setting can't be written) or when the
 * effective value is already at least the target.
 */
export async function raiseWorkspaceMaxRequests(): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) {
        return;
    }
    const current = getEffectiveMaxRequests();
    if (typeof current === 'number' && current >= WORKSPACE_MAX_REQUESTS) {
        return;
    }
    const config = vscode.workspace.getConfiguration(MAX_REQUESTS_SECTION);
    await config.update(MAX_REQUESTS_KEY, WORKSPACE_MAX_REQUESTS, vscode.ConfigurationTarget.Workspace);
}

function showStatusBarItem(): void {
    if (!statusBarItem) {
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        statusBarItem.command = DISABLE_AUTOPILOT_COMMAND;
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        extensionContext?.subscriptions.push(statusBarItem);
    }
    statusBarItem.text = `$(rocket) ${vscode.l10n.t('Autopilot ON')}`;
    statusBarItem.tooltip = vscode.l10n.t('Autopilot is auto-approving all chat tool actions. Click to turn it off.');
    statusBarItem.show();
}

function hideStatusBarItem(): void {
    statusBarItem?.hide();
}

function disposeCompletionWatcher(): void {
    completionWatcher?.dispose();
    completionWatcher = undefined;
}

function clearSafetyTimer(): void {
    if (safetyTimer) {
        clearTimeout(safetyTimer);
        safetyTimer = undefined;
    }
}

/** (Re)schedules the safety timeout that restores auto-approve at `deadline`. */
function scheduleSafetyTimer(deadline: number): void {
    clearSafetyTimer();
    const ms = Math.max(0, deadline - Date.now());
    safetyTimer = setTimeout(() => { void disableAutopilot(); }, ms);
}

/** Arms the user-facing run aids: status bar, completion watcher, safety timeout. */
function armAutopilot(deadline: number): void {
    showStatusBarItem();
    registerCompletionWatcher();
    scheduleSafetyTimer(deadline);
}

/** Returns true when the debug plan file content indicates the chain is finished. */
export function isDebugPlanImplemented(content: string): boolean {
    // Tolerates markdown formatting around the status line, e.g.
    // `> **Status:** Implemented`, `Status: Implemented`, `**Status**: implemented`.
    return /status\b[^a-z0-9]{0,8}implemented\b/i.test(content);
}

function registerCompletionWatcher(): void {
    disposeCompletionWatcher();
    completionWatcher = vscode.workspace.createFileSystemWatcher(DEBUG_PLAN_GLOB);
    const check = async (uri: vscode.Uri): Promise<void> => {
        let content: string;
        try {
            content = await AzExtFsExtra.readFile(uri);
        } catch {
            return;
        }
        if (isDebugPlanImplemented(content)) {
            await disableAutopilot();
        }
    };
    completionWatcher.onDidCreate((uri) => void check(uri));
    completionWatcher.onDidChange((uri) => void check(uri));
}

/**
 * Enables autopilot: records the user's current global auto-approve value, turns
 * the setting on globally, raises the workspace request limit, and arms the
 * status-bar item and completion watcher.
 */
export async function enableAutopilot(context: vscode.ExtensionContext): Promise<void> {
    extensionContext = context;

    // Don't clobber a previously-saved prior value if autopilot is already on.
    if (context.globalState.get<boolean>(STATE_ACTIVE) !== true) {
        await context.globalState.update(STATE_PRIOR_VALUE, getAutoApproveValue() ?? null);
    }
    const deadline = Date.now() + MAX_RUN_DURATION_MS;
    await context.globalState.update(STATE_ACTIVE, true);
    await context.globalState.update(STATE_DEADLINE, deadline);

    await setAutoApproveValue(true);
    // The request limit is bumped at the Workspace scope and intentionally left
    // in place (not restored) — see WORKSPACE_MAX_REQUESTS.
    await raiseWorkspaceMaxRequests();
    armAutopilot(deadline);
}

/**
 * Restores the global auto-approve setting to the value captured when autopilot
 * was enabled, and tears down the status-bar item and completion watcher.
 */
export async function disableAutopilot(): Promise<void> {
    const context = extensionContext;
    if (!context) {
        hideStatusBarItem();
        disposeCompletionWatcher();
        return;
    }

    if (context.globalState.get<boolean>(STATE_ACTIVE) === true) {
        const prior = context.globalState.get<unknown>(STATE_PRIOR_VALUE);
        // `null` means there was no explicit global value, so clear it.
        await setAutoApproveValue(prior === null ? undefined : prior);
        // Note: `chat.agent.maxRequests` is deliberately NOT restored — it was
        // written at the Workspace scope and is left in place.
        await context.globalState.update(STATE_ACTIVE, false);
        await context.globalState.update(STATE_PRIOR_VALUE, undefined);
        await context.globalState.update(STATE_DEADLINE, undefined);
    }

    clearSafetyTimer();
    hideStatusBarItem();
    disposeCompletionWatcher();
}

/**
 * Wires up autopilot for the extension lifetime: registers the disable command
 * and reconciles any prior active run.
 *
 * If a previous session left autopilot active and the run is still within its
 * safety deadline (e.g. a window reload, or a second window opened mid-run), it
 * is **re-armed** so the chain keeps running unattended rather than being killed.
 * If the deadline has already elapsed (crash / abandoned run), auto-approve is
 * restored immediately as a security-first safety net.
 */
export function registerAutopilot(context: vscode.ExtensionContext): void {
    extensionContext = context;

    context.subscriptions.push(
        vscode.commands.registerCommand(DISABLE_AUTOPILOT_COMMAND, () => disableAutopilot()),
    );

    if (context.globalState.get<boolean>(STATE_ACTIVE) === true) {
        const deadline = context.globalState.get<number>(STATE_DEADLINE) ?? 0;
        if (Date.now() < deadline) {
            armAutopilot(deadline);
        } else {
            void disableAutopilot();
        }
    }
}
