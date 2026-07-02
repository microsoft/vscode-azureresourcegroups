/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ScaffoldNextStepsViewController } from "./controllers/ScaffoldNextStepsViewController";
import { markProjectPlanIntegrated } from "./flowState";
import { closeLoadingView } from "./openLoadingView";
import { SingletonViewHost } from "./utils/singletonViewHost";

const host = new SingletonViewHost<Record<string, never>, ScaffoldNextStepsViewController>({
    createController: (config) => new ScaffoldNextStepsViewController(config),
    updateController: (controller, config) => controller.updateConfig(config),
});

/**
 * Show the post-scaffolding "what's next" view. Disposes any open
 * loading view first so the next-steps panel takes its place.
 */
export function openScaffoldNextStepsView(config: Record<string, never>): void {
    closeLoadingView();
    void markProjectPlanIntegrated();
    host.show(config);
}

export function isScaffoldNextStepsViewOpen(): boolean {
    return host.isOpen;
}
