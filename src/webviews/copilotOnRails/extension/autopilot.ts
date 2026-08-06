/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtFsExtra, callWithTelemetryAndErrorHandling, type IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { ext } from "../../../extensionVariables";
import { createProjectPlanFileWatcher, DEBUG_PLAN_FILE_GLOB } from "../../../tree/project/projectPlanFiles";
import { CopilotOnRailsContext } from "../../../utils/copilotOnRails/CopilotOnRailsContext";
import { callWithDiagnosticsAndTelemetryHandling, corId, setCorProp } from "../../../utils/copilotOnRails/telemetryUtils";
import { settingUtils } from "../../../utils/settingUtils";
import { getDebugPlanStatus, LocalDebugPlanStatus, parseLocalDebugPlanMarkdown } from "../views/utils/parseLocalDebugPlanMarkdown";
import { isApprovedOrLater } from "../views/utils/projectPlanStatus";
import { armDebugPlanImplementedWatcher } from "./debugPlanImplementedWatcher";

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
/** Set once per run to ensure the debug-plan approval telemetry has been recorded */
const STATE_DEBUG_APPROVAL_RECORDED = 'copilotOnRails.autopilot.debugPlanApprovalRecorded';

/** Command id used by the status-bar item to turn autopilot off. */
export const DISABLE_AUTOPILOT_COMMAND = 'azureResourceGroups.disableAutopilot';

let statusBarItem: vscode.StatusBarItem | undefined;
let completionWatcher: vscode.FileSystemWatcher | undefined;
let safetyTimer: ReturnType<typeof setTimeout> | undefined;
let extensionContext: vscode.ExtensionContext | undefined;
/** In-process copy of the persisted {@link STATE_DEBUG_APPROVAL_RECORDED} flag, so overlapping create/change watcher events can't each record the approval before the persisted write completes. */
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
    debugPlanApprovalRecorded = extensionContext?.workspaceState.get<boolean>(STATE_DEBUG_APPROVAL_RECORDED) === true;
    showStatusBarItem();
    registerDebugCompletionWatcher();
    scheduleSafetyTimer(deadline);
}

/** Returns true when the debug plan file content indicates the chain is finished. */
function registerDebugCompletionWatcher(): void {
    disposeCompletionWatcher();
    completionWatcher = createProjectPlanFileWatcher(DEBUG_PLAN_FILE_GLOB);
    const check = async (uri: vscode.Uri): Promise<void> => {
        let content: string;
        try {
            content = await AzExtFsExtra.readFile(uri);
        } catch {
            return;
        }
        await checkDebugPlanCompletion(content);
    };
    completionWatcher.onDidCreate((uri) => void check(uri));
    completionWatcher.onDidChange((uri) => void check(uri));

    // `createFileSystemWatcher` only reports changes made after it arms, so any milestone the plan
    // already reached before this point would never fire an event and be silently missed. Eagerly reconcile
    // against the current file state.
    void checkCurrentDebugPlanState();
}

/** Reacts to the current debug plan content: records the auto-approval milestone and/or ends the run. */
async function checkDebugPlanCompletion(content: string): Promise<void> {
    if (!debugPlanApprovalRecorded && isApprovedOrLater(parseLocalDebugPlanMarkdown(content).status)) {
        await recordAutopilotDebugPlanApproval();
    }

    if (getDebugPlanStatus(content)?.toLowerCase() === LocalDebugPlanStatus.Implemented) {
        await disableAutopilot();
    }
}

/** Reads the current debug plan (if any) and reconciles it, so milestones reached before arming aren't lost. */
async function checkCurrentDebugPlanState(): Promise<void> {
    const [uri] = await vscode.workspace.findFiles(DEBUG_PLAN_FILE_GLOB, undefined, 1);
    if (!uri) {
        return;
    }
    let content: string;
    try {
        content = await AzExtFsExtra.readFile(uri);
    } catch {
        return;
    }
    await checkDebugPlanCompletion(content);
}

/**
 * Records the "submit debug plan approval" telemetry action on the autopilot path.
 * In autopilot the plan is auto-approved, so the manual approval UI action in the
 * local plan view never fires. This ensures the same event fires in autopilot mode.
 */
async function recordAutopilotDebugPlanApproval(): Promise<void> {
    const context = extensionContext;
    if (!context || !isAutopilotActive() || debugPlanApprovalRecorded) {
        return;
    }

    debugPlanApprovalRecorded = true;

    try {
        await armDebugPlanImplementedWatcher();

        await callWithTelemetryAndErrorHandling(corId('submitDebugPlanApproval'), async (actionContext: IActionContext) => {
            actionContext.errorHandling.suppressDisplay = true;
            await callWithDiagnosticsAndTelemetryHandling(actionContext, { type: 'extensionAction', name: 'submitDebugPlanApproval' }, (corContext: CopilotOnRailsContext) => {
                setCorProp(corContext, 'approvalOutcome', 'submitted');
                return Promise.resolve();
            });
        });

        await context.workspaceState.update(STATE_DEBUG_APPROVAL_RECORDED, true);
    } catch (error) {
        debugPlanApprovalRecorded = false;
        throw error;
    }
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
        await context.workspaceState.update(STATE_DEBUG_APPROVAL_RECORDED, undefined);
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
        await context.workspaceState.update(STATE_DEBUG_APPROVAL_RECORDED, undefined);
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
