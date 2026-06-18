/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

/**
 * Autopilot ("YOLO") mode for the create-project workflow.
 *
 * When the user submits the requirements form with autopilot enabled, the whole
 * plan -> scaffold -> local-debug chain runs end-to-end without approval gates.
 * To make tool actions (file edits, terminal commands) run unattended, we flip
 * VS Code's global `chat.tools.global.autoApprove` setting on for the duration
 * of the run and restore it afterward.
 *
 * Because that setting is global and security-sensitive, restoration is layered:
 *  1. A completion watcher restores it the moment the local debug plan reaches
 *     `Status: Implemented` (the end of the chain).
 *  2. A status-bar item lets the user turn it off manually at any time.
 *  3. On the next activation, if a prior session left autopilot active, it is
 *     restored immediately (covers window reloads / crashes mid-run).
 */

const AUTO_APPROVE_SECTION = 'chat.tools.global';
const AUTO_APPROVE_KEY = 'autoApprove';

/** Marker embedded in the chat query so agents can detect an autopilot run. */
export const AUTOPILOT_QUERY_MARKER = '[AUTOPILOT MODE]';

/** Glob for the local debug plan whose completion ends an autopilot run. */
const DEBUG_PLAN_GLOB = '.azure/vscode-debug-plan.md';

/** globalState keys used to survive window reloads mid-run. */
const STATE_ACTIVE = 'azureResourceGroups.autopilot.active';
const STATE_PRIOR_VALUE = 'azureResourceGroups.autopilot.priorAutoApprove';

/** Command id used by the status-bar item to turn autopilot off. */
export const DISABLE_AUTOPILOT_COMMAND = 'azureResourceGroups.disableAutopilot';

let statusBarItem: vscode.StatusBarItem | undefined;
let completionWatcher: vscode.FileSystemWatcher | undefined;
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

function showStatusBarItem(): void {
    if (!statusBarItem) {
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        statusBarItem.command = DISABLE_AUTOPILOT_COMMAND;
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        extensionContext?.subscriptions.push(statusBarItem);
    }
    statusBarItem.text = '$(rocket) Autopilot ON';
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

/** Returns true when the debug plan file content indicates the chain is finished. */
function isDebugPlanImplemented(content: string): boolean {
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
            content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
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
 * the setting on globally, and arms the status-bar item and completion watcher.
 */
export async function enableAutopilot(context: vscode.ExtensionContext): Promise<void> {
    extensionContext = context;

    // Don't clobber a previously-saved prior value if autopilot is already on.
    if (context.globalState.get<boolean>(STATE_ACTIVE) !== true) {
        await context.globalState.update(STATE_PRIOR_VALUE, getAutoApproveValue() ?? null);
    }
    await context.globalState.update(STATE_ACTIVE, true);

    await setAutoApproveValue(true);
    showStatusBarItem();
    registerCompletionWatcher();
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
        await context.globalState.update(STATE_ACTIVE, false);
        await context.globalState.update(STATE_PRIOR_VALUE, undefined);
    }

    hideStatusBarItem();
    disposeCompletionWatcher();
}

/**
 * Wires up autopilot for the extension lifetime: registers the disable command
 * and, if a previous session left autopilot active (e.g. a window reload), it is
 * restored immediately as a security-first safety net.
 */
export function registerAutopilot(context: vscode.ExtensionContext): void {
    extensionContext = context;

    context.subscriptions.push(
        vscode.commands.registerCommand(DISABLE_AUTOPILOT_COMMAND, () => disableAutopilot()),
    );

    if (context.globalState.get<boolean>(STATE_ACTIVE) === true) {
        void disableAutopilot();
    }
}
