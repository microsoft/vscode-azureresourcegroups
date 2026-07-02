/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type LoadingViewConfiguration } from "../views/utils/viewConfigTypes";
import { LoadingViewController } from "./controllers/LoadingViewController";
import { SingletonViewHost } from "./utils/singletonViewHost";

const host = new SingletonViewHost<LoadingViewConfiguration, LoadingViewController>({
    createController: (config) => new LoadingViewController(config),
    updateController: (controller, config) => controller.updateConfig(config),
});

/**
 * Show or update the transient loading view used to bridge workflow steps
 */
export function openLoadingView(config: LoadingViewConfiguration): void {
    host.show(config);
}

/** Dispose the loading view, if any. Safe to call when no loading view is open. */
export function closeLoadingView(): void {
    host.close();
}

export function isLoadingViewOpen(): boolean {
    return host.isOpen;
}
