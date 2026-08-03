/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtFsExtra, callWithTelemetryAndErrorHandling, type IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { DEBUG_PLAN_FILE_GLOB } from "../../../tree/project/projectPlanFiles";
import { CopilotOnRailsContext } from "../../../utils/copilotOnRails/CopilotOnRailsContext";
import { callWithDiagnosticsAndTelemetryHandling, corId } from "../../../utils/copilotOnRails/telemetryUtils";
import { isDebugPlanImplemented, parseLocalDebugPlanMarkdown, type LocalPlanData } from "../views/utils/parseLocalDebugPlanMarkdown";
import { isApprovedOrLater } from "../views/utils/projectPlanStatus";
import { recordLocalDebugPlanTelemetry } from "./utils/localDebugPlanTelemetryUtils";

/**
 * Records the rich {@link recordLocalDebugPlanTelemetry} snapshot once the debug plan reaches
 * `Implemented`, rather than at approval time. At approval the plan only reflects what was
 * *offered/selected*; once implemented it reflects what was actually built (configs generated,
 * checkboxes ticked, prerequisites installed, migrations/API-test collections created), so this is
 * the point with the most to inspect.
 *
 * The watcher is single-shot per run: it self-disposes the moment the implemented telemetry is
 * recorded, guarded by an in-memory flag (against overlapping create/change events) and a persisted
 * {@link STATE_IMPLEMENTED_RECORDED} flag (so the event fires at most once even across window
 * reloads). Approval is the "new run" boundary - {@link armDebugPlanImplementedWatcher} clears the
 * persisted flag and re-arms so a re-approval or regenerated plan is captured again.
 */

/**
 * workspaceState key set once the implemented telemetry has been recorded for the current run, so
 * the event fires at most once and survives window reloads. Cleared at approval to open a new run.
 */
const STATE_IMPLEMENTED_RECORDED = 'copilotOnRails.debugPlan.implementedRecorded';

let watcher: vscode.FileSystemWatcher | undefined;
let extensionContext: vscode.ExtensionContext | undefined;
/**
 * In-process copy of the persisted {@link STATE_IMPLEMENTED_RECORDED} flag, so overlapping
 * create/change watcher events (and the eager check on arm) can't each record before the persisted
 * write completes.
 */
let implementedRecorded = false;

/**
 * Wires up the implemented-telemetry watcher for the extension lifetime and reconciles any run that
 * was already in flight when the window (re)loaded: if the telemetry was already recorded there is
 * nothing to do; if the plan is already `Implemented` it records immediately; otherwise, if the plan
 * is approved-or-later, it re-arms so the pending `Implemented` transition is still captured.
 */
export function registerDebugPlanImplementedWatcher(context: vscode.ExtensionContext): void {
    extensionContext = context;
    implementedRecorded = context.workspaceState.get<boolean>(STATE_IMPLEMENTED_RECORDED) === true;
    context.subscriptions.push({ dispose: () => disposeWatcher() });
    void reconcile();
}

/**
 * Arms the watcher at the point the plan is approved. Approval is the "new run" boundary, so the
 * persisted record flag is cleared first - this is what lets a re-approval (a re-run, or a
 * regenerated plan) be captured again. Because the plan may already be `Implemented` by the time we
 * arm (a fast autopilot run, or re-arming after a reload), the current content is checked eagerly
 * rather than relying on a future change event that may never fire.
 */
export async function armDebugPlanImplementedWatcher(): Promise<void> {
    if (!extensionContext) {
        return;
    }

    implementedRecorded = false;
    await extensionContext.workspaceState.update(STATE_IMPLEMENTED_RECORDED, undefined);

    armWatcher();

    const content = await readDebugPlan();
    if (content !== undefined && isDebugPlanImplemented(content)) {
        await recordImplemented(content);
    }
}

async function reconcile(): Promise<void> {
    if (implementedRecorded) {
        return;
    }
    const content = await readDebugPlan();
    if (content === undefined) {
        // No debug plan yet; approval will arm the watcher once the phase begins.
        return;
    }
    if (isDebugPlanImplemented(content)) {
        await recordImplemented(content);
        return;
    }
    if (isApprovedOrLater(parseLocalDebugPlanMarkdown(content).status)) {
        armWatcher();
    }
}

function armWatcher(): void {
    if (watcher) {
        return;
    }
    watcher = vscode.workspace.createFileSystemWatcher(DEBUG_PLAN_FILE_GLOB);
    const check = async (uri: vscode.Uri): Promise<void> => {
        if (implementedRecorded) {
            return;
        }
        let content: string;
        try {
            content = await AzExtFsExtra.readFile(uri);
        } catch {
            return;
        }
        if (isDebugPlanImplemented(content)) {
            await recordImplemented(content);
        }
    };
    watcher.onDidCreate((uri) => void check(uri));
    watcher.onDidChange((uri) => void check(uri));
}

async function recordImplemented(content: string): Promise<void> {
    const context = extensionContext;
    if (!context || implementedRecorded) {
        return;
    }

    // Set both guards up front so overlapping create/change events (and the eager check on arm)
    // can't each record before the persisted write completes.
    implementedRecorded = true;
    await context.workspaceState.update(STATE_IMPLEMENTED_RECORDED, true);

    let planData: LocalPlanData;
    try {
        planData = parseLocalDebugPlanMarkdown(content);
    } catch {
        // If the final plan can't be parsed there is nothing to inspect, but the run is still done -
        // stop watching so we don't spin on further edits.
        disposeWatcher();
        return;
    }

    await callWithTelemetryAndErrorHandling(corId('recordDebugPlanImplemented'), async (actionContext: IActionContext) => {
        actionContext.errorHandling.suppressDisplay = true;
        // `webviewAction` mirrors the debug-plan telemetry family (see the autopilot approval path);
        // this milestone is file-driven, but keeping the type consistent lets the debug-plan events
        // aggregate together. The shared wrapper stamps `autopilot`, so auto vs. manual stays distinct.
        await callWithDiagnosticsAndTelemetryHandling(actionContext, { type: 'webviewAction', name: 'recordDebugPlanImplemented' }, (corContext: CopilotOnRailsContext) => {
            recordLocalDebugPlanTelemetry(corContext, planData);
            return Promise.resolve();
        });
    });

    // The run's telemetry is captured; nothing left to watch for.
    disposeWatcher();
}

function disposeWatcher(): void {
    watcher?.dispose();
    watcher = undefined;
}

async function readDebugPlan(): Promise<string | undefined> {
    const [uri] = await vscode.workspace.findFiles(DEBUG_PLAN_FILE_GLOB, undefined, 1);
    if (!uri) {
        return undefined;
    }
    try {
        return await AzExtFsExtra.readFile(uri);
    } catch {
        return undefined;
    }
}
