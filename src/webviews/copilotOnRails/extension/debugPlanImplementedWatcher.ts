/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtFsExtra, callWithTelemetryAndErrorHandling, type IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { createProjectPlanFileWatcher, DEBUG_PLAN_FILE_GLOB } from "../../../tree/project/projectPlanFiles";
import { CopilotOnRailsContext } from "../../../utils/copilotOnRails/CopilotOnRailsContext";
import { callWithDiagnosticsAndTelemetryHandling, corId } from "../../../utils/copilotOnRails/telemetryUtils";
import { getDebugPlanStatus, LocalDebugPlanStatus, parseLocalDebugPlanMarkdown, type LocalPlanData } from "../views/utils/parseLocalDebugPlanMarkdown";
import { isApprovedOrLater } from "../views/utils/projectPlanStatus";
import { recordLocalDebugPlanTelemetry } from "./utils/localDebugPlanTelemetryUtils";

/**
 * Records debug plan telemetry once the debug plan reaches `Implemented`.
 *
 * The watcher is single-shot per run: it self-disposes the moment the implemented telemetry is
 * recorded, guarded by an in-memory flag (against overlapping create/change events) and a persisted
 * {@link STATE_IMPLEMENTED_RECORDED} flag (so the event fires at most once even across window
 * reloads).
 */

/**
 * `workspaceState` key set once the implemented telemetry has been recorded for the current run, so
 * the event fires at most once and survives window reloads.
 */
const STATE_IMPLEMENTED_RECORDED = 'copilotOnRails.debugPlan.implementedRecorded';

/**
 * How long to wait after the last observed write to the debug plan before snapshotting key components for
 * telemetry.
 */
const DEBUG_PLAN_SETTLE_MS = 5000;

let watcher: vscode.FileSystemWatcher | undefined;
let recordTimer: NodeJS.Timeout | undefined;
let extensionContext: vscode.ExtensionContext | undefined;
/**
 * In-process copy of the persisted {@link STATE_IMPLEMENTED_RECORDED} flag, so overlapping
 * create/change watcher events can't each record before the persisted write completes.
 */
let implementedRecorded = false;

/**
 * Wires up the implemented plan watcher and resumes any run that
 * was already in flight when the window (re)loaded
 */
export function registerDebugPlanImplementedWatcher(context: vscode.ExtensionContext): void {
    extensionContext = context;
    implementedRecorded = context.workspaceState.get<boolean>(STATE_IMPLEMENTED_RECORDED) === true;
    context.subscriptions.push({ dispose: () => disposeWatcher() });
    void syncToCurrentPlanState();
}

/**
 * Arms an implemented watcher after the plan is approved.
 */
export async function armDebugPlanImplementedWatcher(): Promise<void> {
    if (!extensionContext) {
        return;
    }

    implementedRecorded = false;
    await extensionContext.workspaceState.update(STATE_IMPLEMENTED_RECORDED, undefined);

    armImplementedPlanWatcher();

    const content = await readDebugPlan();
    if (content !== undefined && getDebugPlanStatus(content)?.toLowerCase() === LocalDebugPlanStatus.Implemented) {
        scheduleRecord();
    }
}

async function syncToCurrentPlanState(): Promise<void> {
    if (implementedRecorded) {
        return;
    }
    const content = await readDebugPlan();
    if (content === undefined) {
        // No debug plan yet; approval will arm the watcher once the phase begins.
        return;
    }
    const implemented = getDebugPlanStatus(content)?.toLowerCase() === LocalDebugPlanStatus.Implemented;
    if (implemented || isApprovedOrLater(parseLocalDebugPlanMarkdown(content).status)) {
        armImplementedPlanWatcher();
    }
    if (implemented) {
        scheduleRecord();
    }
}

function armImplementedPlanWatcher(): void {
    if (watcher) {
        return;
    }
    watcher = createProjectPlanFileWatcher(DEBUG_PLAN_FILE_GLOB);
    const checkImplemented = async (uri: vscode.Uri): Promise<void> => {
        if (implementedRecorded) {
            return;
        }
        let content: string;
        try {
            content = await AzExtFsExtra.readFile(uri);
        } catch {
            return;
        }
        if (getDebugPlanStatus(content)?.toLowerCase() === LocalDebugPlanStatus.Implemented) {
            // Don't snapshot this event's content directly - it may be an intermediate write. Let the
            // debounce settle and re-read the freshest file, so trailing writes aren't missed.
            scheduleRecord();
        }
    };
    watcher.onDidCreate((uri) => void checkImplemented(uri));
    watcher.onDidChange((uri) => void checkImplemented(uri));
}

/** (Re)starts the settle timer; every observed write pushes the snapshot back until writes go quiet. */
function scheduleRecord(): void {
    if (implementedRecorded) {
        return;
    }
    if (recordTimer) {
        clearTimeout(recordTimer);
    }
    recordTimer = setTimeout(() => void settleAndRecord(), DEBUG_PLAN_SETTLE_MS);
}

/** Fires once writes have settled: reads the freshest plan and records it if it still reads `Implemented`. */
async function settleAndRecord(): Promise<void> {
    recordTimer = undefined;
    if (implementedRecorded) {
        return;
    }
    const content = await readDebugPlan();
    if (content === undefined || getDebugPlanStatus(content)?.toLowerCase() !== LocalDebugPlanStatus.Implemented) {
        return;
    }
    await recordImplemented(content);
}

async function recordImplemented(content: string): Promise<void> {
    const context = extensionContext;
    if (!context || implementedRecorded) {
        return;
    }

    let planData: LocalPlanData;
    try {
        planData = parseLocalDebugPlanMarkdown(content);
    } catch {
        // If the final plan can't be parsed there is nothing to inspect, but the run is still done -
        // stop watching so we don't spin on further edits.
        disposeWatcher();
        return;
    }

    implementedRecorded = true;

    await callWithTelemetryAndErrorHandling(corId('recordDebugPlanImplemented'), async (actionContext: IActionContext) => {
        actionContext.errorHandling.suppressDisplay = true;
        await callWithDiagnosticsAndTelemetryHandling(actionContext, { type: 'extensionAction', name: 'recordDebugPlanImplemented' }, (corContext: CopilotOnRailsContext) => {
            recordLocalDebugPlanTelemetry(corContext, planData);
            return Promise.resolve();
        });
    });

    await context.workspaceState.update(STATE_IMPLEMENTED_RECORDED, true);

    // The run's telemetry is captured; nothing left to watch for.
    disposeWatcher();
}

function disposeWatcher(): void {
    if (recordTimer) {
        clearTimeout(recordTimer);
        recordTimer = undefined;
    }
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
