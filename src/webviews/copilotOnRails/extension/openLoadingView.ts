/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { type LoadingViewConfiguration } from "../views/utils/viewConfigTypes";
import { LoadingViewController } from "./controllers/LoadingViewController";
import { trackFlowView } from "./utils/singletonViewHost";

let controller: LoadingViewController | undefined;

/**
 * Show or update the transient loading view used to bridge workflow steps
 */
export function openLoadingView(config: LoadingViewConfiguration): void {
    if (controller) {
        controller.updateConfig(config);
        controller.revealToForeground(vscode.ViewColumn.Active);
        return;
    }

    controller = new LoadingViewController(config);
    trackFlowView(controller.panel);
    controller.revealToForeground(vscode.ViewColumn.Active);
    controller.panel.onDidDispose(() => {
        controller = undefined;
    });
}

/** Dispose the loading view, if any. Safe to call when no loading view is open. */
export function closeLoadingView(): void {
    controller?.panel.dispose();
    controller = undefined;
}

export function isLoadingViewOpen(): boolean {
    return controller !== undefined;
}
