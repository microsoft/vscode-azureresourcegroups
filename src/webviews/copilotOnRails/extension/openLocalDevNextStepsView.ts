/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { type LocalDevNextStepsViewConfiguration } from "../views/utils/viewConfigTypes";
import { LocalDevNextStepsViewController } from "./controllers/LocalDevNextStepsViewController";
import { closeLoadingView } from "./openLoadingView";
import { completeSession } from "./telemetry/workflowTelemetry";

let controller: LocalDevNextStepsViewController | undefined;

/**
 * Show the post-local-development "what's next" view. Disposes any open
 * loading view first so the next-steps panel takes its place.
 *
 * When `hasApiTests` is not explicitly provided, auto-detects by checking
 * whether `api-test-collections/` contains any files in the workspace.
 */
export async function openLocalDevNextStepsView(hasApiTests?: boolean): Promise<void> {
    let apiTestsDetected = !!hasApiTests;
    if (!apiTestsDetected) {
        const results = await vscode.workspace.findFiles('api-test-collections/**/*', undefined, 1);
        apiTestsDetected = results.length > 0;
    }

    const config: LocalDevNextStepsViewConfiguration = { hasApiTests: apiTestsDetected };

    closeLoadingView();

    // Reaching the local-dev "Next Steps" view is the natural end of the
    // create + local-debug flow, so finalize the diagnostics session here. This
    // is a reliable, extension-owned completion signal (unlike scraping a
    // status string out of a plan file). A follow-on deploy starts a new run.
    void completeSession('completed');

    if (controller) {
        controller.updateConfig(config);
        controller.revealToForeground(vscode.ViewColumn.Active);
        return;
    }

    controller = new LocalDevNextStepsViewController(config);
    controller.revealToForeground(vscode.ViewColumn.Active);
    controller.panel.onDidDispose(() => {
        controller = undefined;
    });
}

export function isLocalDevNextStepsViewOpen(): boolean {
    return controller !== undefined;
}
