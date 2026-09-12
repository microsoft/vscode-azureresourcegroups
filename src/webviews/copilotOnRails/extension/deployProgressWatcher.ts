/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import {
    APP_ONBOARD_CONTEXT_FILE_GLOB,
    createProjectPlanFileWatcher,
    DEPLOY_RESULT_FILE_GLOBS,
    findProjectFiles,
} from "../../../tree/project/projectPlanFiles";
import { getAzureResourcesService } from "../../../services/AzureResourcesService";
import { resolveSubscription } from "../../../utils/copilotOnRails/deploymentInventoryCapture";
import { type LoadingStep, type LoadingViewConfiguration } from "../views/utils/viewConfigTypes";
import { closeLoadingView, openLoadingView, updateLoadingView } from "./openLoadingView";
import {
    buildDeployProgressMessage,
    buildDeployProgressSteps,
    buildDeployProgressTitle,
    deployProgressStepIds,
    isAwaitingDeployApproval,
    parseDeployProgressContext,
    parseDeployResultStatus,
    type DeployProgressSignals,
} from "./utils/deployProgressSteps";
import {
    buildResourceSteps,
    buildResourceSummary,
    parseDeployTarget,
    selectTrackedDeployments,
    type ArmDeploymentOperationLike,
    type DeployTarget,
} from "./utils/deployResourceProgress";
import { readFileText } from "./utils/singletonViewHost";

/**
 * Drives the deployment progress view that is shown between approving the deployment plan and
 * the Deployment Results view opening.
 *
 * The deploy agent runs for many minutes across several phases, and its only durable progress
 * record is the App Onboard session artifacts. This watcher tails `context.json` and
 * `deploy-result.json` and republishes the derived step list into the loading view, so the user
 * sees the pipeline advance instead of an indefinite spinner.
 *
 * While the deploy itself is running it additionally polls ARM for the in-flight deployment's
 * operations, which is the only source that knows *which resource* is being provisioned right now.
 */

/**
 * Writes to these artifacts arrive in bursts (the agent rewrites `context.json` at every phase
 * transition), so coalesce them before re-reading and re-rendering.
 */
const REFRESH_DEBOUNCE_MS = 400;

/**
 * How often ARM is polled for deployment operations while provisioning runs. Long enough to stay
 * far clear of ARM read throttling over a deploy that can run for tens of minutes, short enough
 * that the list visibly tracks the deployment.
 */
const RESOURCE_POLL_INTERVAL_MS = 10_000;

/** Caps the ARM requests per poll when a resource group has a long deployment history. */
const MAX_TRACKED_DEPLOYMENTS = 5;

let watchers: vscode.Disposable[] = [];
let refreshTimer: NodeJS.Timeout | undefined;
/**
 * Incremented every time tracking is armed or disarmed, so an in-flight async refresh belonging to
 * a previous deployment can't publish its (now stale) reading into a newer progress session.
 */
let generation = 0;
/**
 * When tracking started. Used to ignore ARM deployments in the target resource group that predate
 * this run, so a repeat deployment doesn't inherit the previous one's resource list.
 */
let trackingStartedAtMs = 0;
let resourcePollTimer: NodeJS.Timeout | undefined;
/** Latest per-resource checklist from ARM, rendered under the provisioning step. */
let resourceSteps: LoadingStep[] = [];

/**
 * Opens the deployment progress view and starts tracking the App Onboard artifacts.
 * Called once the user approves the deployment plan.
 */
export function startDeployProgressView(): void {
    disarmDeployProgressWatcher();
    trackingStartedAtMs = Date.now();

    // Closing the tab is the user's way out of a deployment that was cancelled at the Chat gate:
    // end the whole tracking session rather than leaving a "Show Copilot progress" spinner behind
    // that would only ever reopen on a stale snapshot. Nothing is lost — the Deployment Results
    // view opens on its own once `deploy-result.json` reaches a terminal status.
    openLoadingView(buildConfig({}), {
        onUserClose: () => {
            disarmDeployProgressWatcher();
            // Also drop the retained config so the "Show Copilot progress" command can't bring the
            // dismissed view back on a snapshot nothing is updating any more.
            closeLoadingView();
        },
    });

    for (const glob of [APP_ONBOARD_CONTEXT_FILE_GLOB, ...DEPLOY_RESULT_FILE_GLOBS]) {
        const watcher = createProjectPlanFileWatcher(glob);
        watcher.onDidCreate(scheduleRefresh);
        watcher.onDidChange(scheduleRefresh);
        watchers.push(watcher);
    }

    // The agent may already have advanced the session before the first watcher event fires
    // (for example when the plan is approved on a resumed session), so seed from disk now.
    scheduleRefresh();
}

/**
 * Stops tracking deployment progress. Called when the Deployment Results view takes over, when the
 * user dismisses the progress tab, and as part of extension disposal. Safe to call when nothing is
 * being tracked.
 */
export function disarmDeployProgressWatcher(): void {
    generation++;
    if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = undefined;
    }
    stopResourcePolling();
    resourceSteps = [];
    for (const watcher of watchers) {
        watcher.dispose();
    }
    watchers = [];
}

/** Tears the watcher down with the extension so its file watchers never outlive the window. */
export function registerDeployProgressWatcher(context: vscode.ExtensionContext): void {
    context.subscriptions.push({ dispose: () => disarmDeployProgressWatcher() });
}

function scheduleRefresh(): void {
    if (refreshTimer) {
        clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void refresh();
    }, REFRESH_DEBOUNCE_MS);
}

async function refresh(): Promise<void> {
    if (watchers.length === 0) {
        return;
    }
    const armedGeneration = generation;
    const { signals, target } = await readDeployProgressState();

    // Tracking was disarmed (or re-armed for a different deployment) while we were reading from
    // disk — this reading no longer describes the session the view is showing.
    if (armedGeneration !== generation) {
        return;
    }

    // Poll ARM only while the deploy is actually in flight. Before that there is no deployment to
    // read; after it, `deploy-result.json` is authoritative and the results view is about to open.
    if (signals.deployStatus === 'in-progress' && target) {
        startResourcePolling(target);
    } else {
        stopResourcePolling();
    }

    // `updateLoadingView` reports false once the progress session has ended — the flow handed off
    // to its next surface, so there is nothing left to report progress into.
    if (!updateLoadingView(buildConfig(signals))) {
        disarmDeployProgressWatcher();
    }
}

function buildConfig(signals: DeployProgressSignals): LoadingViewConfiguration {
    const steps = buildDeployProgressSteps(signals).map((step) => {
        if (step.id !== deployProgressStepIds.provision || resourceSteps.length === 0) {
            return step;
        }
        return { ...step, children: resourceSteps, summary: buildResourceSummary(resourceSteps) };
    });

    return {
        stage: 2,
        title: buildDeployProgressTitle(signals),
        message: buildDeployProgressMessage(steps, signals),
        showNeedHelp: true,
        awaitingInput: isAwaitingDeployApproval(signals),
        steps,
    };
}

//#region Live ARM resource polling

function startResourcePolling(target: DeployTarget): void {
    if (resourcePollTimer) {
        return;
    }
    resourcePollTimer = setInterval(() => void pollDeployedResources(target), RESOURCE_POLL_INTERVAL_MS);
    void pollDeployedResources(target);
}

function stopResourcePolling(): void {
    if (resourcePollTimer) {
        clearInterval(resourcePollTimer);
        resourcePollTimer = undefined;
    }
}

/**
 * Reads the in-flight deployment's ARM operations and republishes the per-resource checklist.
 *
 * Entirely best-effort: the user may be signed out, lack `deployments/read` on the resource group,
 * or ARM may throttle. Any of those simply leaves the checklist as it was — the pipeline-level
 * steps still work, so a missing resource list degrades the view rather than breaking it.
 */
async function pollDeployedResources(target: DeployTarget): Promise<void> {
    const armedGeneration = generation;

    await callWithTelemetryAndErrorHandling('copilotOnRails.deployProgressResources', async (context: IActionContext) => {
        // A background poller must never raise error toasts for transient Azure failures.
        context.errorHandling.suppressDisplay = true;
        context.telemetry.suppressIfSuccessful = true;

        const subscription = await resolveSubscription(target.subscriptionId);
        if (!subscription || armedGeneration !== generation) {
            return;
        }

        const service = getAzureResourcesService();
        const { deployments, unavailable } = await service.listDeployments(context, subscription, target.resourceGroupName);
        if (unavailable || armedGeneration !== generation) {
            return;
        }

        const trackedNames = selectTrackedDeployments(deployments, {
            knownNames: target.deploymentNames,
            since: trackingStartedAtMs,
            limit: MAX_TRACKED_DEPLOYMENTS,
        });
        if (trackedNames.length === 0) {
            return;
        }

        const results = await Promise.all(trackedNames.map((name) =>
            service.listDeploymentOperations(context, subscription, name, target.resourceGroupName),
        ));
        if (armedGeneration !== generation) {
            return;
        }

        const operations = results.flatMap((result) => result.operations as ArmDeploymentOperationLike[]);
        const nextSteps = buildResourceSteps(operations);
        if (nextSteps.length === 0) {
            return;
        }

        resourceSteps = nextSteps;
        scheduleRefresh();
    });
}

//#endregion

/** Reads the newest App Onboard artifacts, tolerating missing or half-written files. */
async function readDeployProgressState(): Promise<{ signals: DeployProgressSignals; target: DeployTarget | undefined }> {
    const [contextContent, deployResultContent] = await Promise.all([
        readNewestMatch([APP_ONBOARD_CONTEXT_FILE_GLOB]),
        readNewestMatch(DEPLOY_RESULT_FILE_GLOBS),
    ]);

    return {
        signals: {
            ...(contextContent ? parseDeployProgressContext(contextContent) : {}),
            deployStatus: deployResultContent ? parseDeployResultStatus(deployResultContent) : undefined,
        },
        target: deployResultContent ? parseDeployTarget(deployResultContent) : undefined,
    };
}

/**
 * Reads the most recently modified file matching any of `globs`.
 *
 * Resolved against the file system rather than the search index: the deploy agent git-ignores
 * `.copilot-azure/`, and `vscode.workspace.findFiles` skips git-ignored files by default.
 */
async function readNewestMatch(globs: readonly string[]): Promise<string | undefined> {
    const matches = (await Promise.all(globs.map((glob) => findProjectFiles(glob)))).flat();

    let newest: { uri: vscode.Uri; mtime: number } | undefined;
    for (const uri of matches) {
        try {
            const { mtime } = await vscode.workspace.fs.stat(uri);
            if (!newest || mtime > newest.mtime) {
                newest = { uri, mtime };
            }
        } catch {
            // The file may have been removed between the glob and the stat; skip it.
        }
    }

    if (!newest) {
        return undefined;
    }
    try {
        return await readFileText(newest.uri);
    } catch {
        return undefined;
    }
}
