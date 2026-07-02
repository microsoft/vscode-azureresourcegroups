/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { type LocalDevNextStepsViewConfiguration } from "../views/utils/viewConfigTypes";
import { LocalDevNextStepsViewController } from "./controllers/LocalDevNextStepsViewController";
import { closeLoadingView } from "./openLoadingView";
import { SingletonViewHost } from "./utils/singletonViewHost";

const host = new SingletonViewHost<LocalDevNextStepsViewConfiguration, LocalDevNextStepsViewController>({
    createController: (config) => new LocalDevNextStepsViewController(config),
    updateController: (controller, config) => controller.updateConfig(config),
});

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
    host.show(config);
}

export function isLocalDevNextStepsViewOpen(): boolean {
    return host.isOpen;
}
