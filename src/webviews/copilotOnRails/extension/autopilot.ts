/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtFsExtra, callWithTelemetryAndErrorHandling, type IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { ext } from "../../../extensionVariables";
import { DEBUG_PLAN_FILE_GLOB } from "../../../tree/project/projectPlanFiles";
import { CopilotOnRailsContext } from "../../../utils/copilotOnRails/CopilotOnRailsContext";
import { callWithDiagnosticsAndTelemetryHandling, corId, setCorProp } from "../../../utils/copilotOnRails/telemetryUtils";
import { settingUtils } from "../../../utils/settingUtils";
import { parseLocalDebugPlanMarkdown } from "../views/utils/parseLocalDebugPlanMarkdown";
import { recordLocalDebugPlanTelemetry } from "./utils/localDebugPlanTelemetryUtils";

/**
 * Autopilot mode for the create-project workflow.
 * It temporarily enables global chat tool auto-approve and restores it later.
 * It also raises workspace chat request budget for long unattended runs.
 */

const AUTO_APPROVE_SECTION = 'chat.tools.global';
const AUTO_APPROVE_KEY = 'autoApprove';

const MAX_REQUESTS_SECTION = 'chat.agent';
const MAX_REQUESTS_KEY = 'maxRequests';

/** Workspace request budget used for scaffolding runs. */
export const WORKSPACE_MAX_REQUESTS = 9999;
const PERMISSIONS_SECTION = 'chat.permissions';
const PERMISSIONS_KEY = 'default';

/**
 * Maximum wall-clock duration an autopilot run may keep global auto-approve on.
 * After this elapses the setting is restored even if the chain never completed,
 * so a failed/stalled/abandoned run can't leave auto-approve on forever.
 */
const MAX_RUN_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Marker embedded in the chat query so agents can detect an autopilot run. */
export const AUTOPILOT_QUERY_MARKER = '[AUTOPILOT MODE]';

/** globalState keys used to survive window reloads mid-run. */
const STATE_ACTIVE = 'copilotOnRails.autopilot.active';
const STATE_PRIOR_VALUE = 'copilotOnRails.autopilot.priorAutoApprove';
const STATE_PRIOR_PERMISSION_LEVEL = 'copilotOnRails.autopilot.priorPermissionLevel';
/** Epoch ms after which an active run is considered stale and auto-restored. */
const STATE_DEADLINE = 'copilotOnRails.autopilot.deadline';
/**
 * Workspace-scoped flag set once per autopilot run after the implied debug-plan approval telemetry
 * has been recorded (i.e. once the plan reaches `Approved`), so an unattended run emits the approval
 * action exactly once even across window reloads and repeated file-watcher events. Scoped to the
 * workspace since it tracks that workspace's plan file.
 */
const STATE_APPROVAL_RECORDED = 'copilotOnRails.autopilot.debugPlanApprovalRecorded';

/** Command id used by the status-bar item to turn autopilot off. */
export const DISABLE_AUTOPILOT_COMMAND = 'azureResourceGroups.disableAutopilot';

let statusBarItem: vscode.StatusBarItem | undefined;
let completionWatcher: vscode.FileSystemWatcher | undefined;
let safetyTimer: ReturnType<typeof setTimeout> | undefined;
let extensionContext: vscode.ExtensionContext | undefined;
/** In-process copy of the persisted {@link STATE_APPROVAL_RECORDED} flag, so overlapping create/change watcher events can't each record the approval before the persisted write completes. */
let debugPlanApprovalRecorded = false;

export function isAutopilotActive(): boolean {
    if (ext.context.globalState.get<boolean>(STATE_ACTIVE) !== true) {
        return false;
    }
    return Date.now() < (ext.context.globalState.get<number>(STATE_DEADLINE) ?? 0);
}

function getAutoApproveValue(): unknown {
    // We only ever write at the Global target, so the global value is what we
    // need to preserve and restore.
    return settingUtils.getGlobalSetting<unknown>(AUTO_APPROVE_KEY, AUTO_APPROVE_SECTION);
}

async function setAutoApproveValue(value: unknown): Promise<void> {
    await settingUtils.updateGlobalSetting(AUTO_APPROVE_KEY, value, AUTO_APPROVE_SECTION);
}

/** Gets the effective `chat.agent.maxRequests` value. */
export function getEffectiveMaxRequests(): number | undefined {
    return settingUtils.getWorkspaceSetting<number>(MAX_REQUESTS_KEY, undefined, MAX_REQUESTS_SECTION);
}

/**
 * Raises workspace `chat.agent.maxRequests` to {@link WORKSPACE_MAX_REQUESTS}
 * when possible. The value is intentionally left in workspace settings.
 */
export async function raiseWorkspaceMaxRequests(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        return;
    }
    const current = getEffectiveMaxRequests();
    if (typeof current === 'number' && current >= WORKSPACE_MAX_REQUESTS) {
        return;
    }
    try {
        await settingUtils.updateWorkspaceSetting(MAX_REQUESTS_KEY, WORKSPACE_MAX_REQUESTS, folder.uri.fsPath, MAX_REQUESTS_SECTION, vscode.ConfigurationTarget.Workspace);
    } catch {
        // Best effort: this setting may not exist on older VS Code versions.
    }
}

function getPermissionLevelValue(): unknown {
    const config = vscode.workspace.getConfiguration(PERMISSIONS_SECTION);
    const inspected = config.inspect(PERMISSIONS_KEY);
    return inspected?.globalValue;
}

async function setPermissionLevelValue(value: unknown): Promise<void> {
    const config = vscode.workspace.getConfiguration(PERMISSIONS_SECTION);
    await config.update(PERMISSIONS_KEY, value, vscode.ConfigurationTarget.Global);
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
    debugPlanApprovalRecorded = extensionContext?.workspaceState.get<boolean>(STATE_APPROVAL_RECORDED) === true;
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

/**
 * Returns true when the debug plan file content indicates the plan has reached approval or beyond.
 *
 * In autopilot the plan's transition to `Approved` is the auto-approval moment - the analog of the
 * manual approve click - and the plan is fully drafted by then. Later states (`Executing`,
 * `Implemented`) still count, so observing a file already past `Approved` is treated as "approval
 * already happened". A still-drafting plan (`Planning` / no status) does not match.
 */
export function isDebugPlanApproved(content: string): boolean {
    // Tolerates markdown formatting around the status line, e.g.
    // `> **Status:** Approved`, `Status: Executing`, `**Status**: implemented`.
    return /status\b[^a-z0-9]{0,8}(approved|executing|implemented)\b/i.test(content);
}

function registerCompletionWatcher(): void {
    disposeCompletionWatcher();
    completionWatcher = vscode.workspace.createFileSystemWatcher(DEBUG_PLAN_FILE_GLOB);
    const check = async (uri: vscode.Uri): Promise<void> => {
        let content: string;
        try {
            content = await AzExtFsExtra.readFile(uri);
        } catch {
            return;
        }
        // The plan reaching `Approved` during an unattended run is the auto-approval moment that
        // stands in for the manual approval the user would otherwise give in the local plan view, so
        // record that approval action before checking whether the chain has finished. A still-drafting
        // plan (`Planning` / no status) is ignored so we never capture an incomplete draft.
        if (isDebugPlanApproved(content)) {
            await recordAutopilotDebugPlanApproval(content);
        }
        if (isDebugPlanImplemented(content)) {
            await disableAutopilot();
        }
    };
    completionWatcher.onDidCreate((uri) => void check(uri));
    completionWatcher.onDidChange((uri) => void check(uri));
}

/**
 * Records the "submit debug plan approval" telemetry action on the autopilot path.
 *
 * In autopilot the plan is auto-approved via VS Code's global chat auto-approve, so the manual
 * approval UI action in the local plan view never fires. This emits the same event through the
 * same telemetry wrapper the manual approval uses - the shared wrapper stamps `autopilot: true`,
 * so the auto-approved event stays distinguishable from a manual one. Fires at most once per run
 * (guarded in-memory and via {@link STATE_APPROVAL_RECORDED}) at the point the plan reaches
 * `Approved`, and never when a manual approval would have fired, since it only runs while autopilot
 * is active.
 */
async function recordAutopilotDebugPlanApproval(content: string): Promise<void> {
    const context = extensionContext;
    if (!context || !isAutopilotActive() || debugPlanApprovalRecorded) {
        return;
    }
    // Latch synchronously first so overlapping create/change events can't double-count.
    debugPlanApprovalRecorded = true;
    await context.workspaceState.update(STATE_APPROVAL_RECORDED, true);

    await callWithTelemetryAndErrorHandling(corId('submitDebugPlanApproval'), async (actionContext: IActionContext) => {
        actionContext.errorHandling.suppressDisplay = true;
        await callWithDiagnosticsAndTelemetryHandling(actionContext, { type: 'webviewAction', name: 'submitDebugPlanApproval' }, (corContext: CopilotOnRailsContext) => {
            setCorProp(corContext, 'approvalOutcome', 'submitted');
            recordLocalDebugPlanTelemetry(corContext, parseLocalDebugPlanMarkdown(content));
            return Promise.resolve();
        });
    });
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
        await context.globalState.update(STATE_PRIOR_PERMISSION_LEVEL, getPermissionLevelValue() ?? null);
        await context.workspaceState.update(STATE_APPROVAL_RECORDED, undefined);
    }
    const deadline = Date.now() + MAX_RUN_DURATION_MS;
    await context.globalState.update(STATE_ACTIVE, true);
    await context.globalState.update(STATE_DEADLINE, deadline);

    await setAutoApproveValue(true);
    await raiseWorkspaceMaxRequests();
    await setPermissionLevelValue('autopilot');
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

        const priorPermission = context.globalState.get<unknown>(STATE_PRIOR_PERMISSION_LEVEL);
        await setPermissionLevelValue(priorPermission === null ? undefined : priorPermission);

        await context.globalState.update(STATE_ACTIVE, undefined);
        await context.globalState.update(STATE_PRIOR_VALUE, undefined);
        await context.globalState.update(STATE_PRIOR_PERMISSION_LEVEL, undefined);
        await context.globalState.update(STATE_DEADLINE, undefined);
        await context.workspaceState.update(STATE_APPROVAL_RECORDED, undefined);
    }

    debugPlanApprovalRecorded = false;

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
