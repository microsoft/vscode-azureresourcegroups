/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ScaffoldNextStepsViewController } from "./controllers/ScaffoldNextStepsViewController";
import { closeLoadingView } from "./openLoadingView";

let controller: ScaffoldNextStepsViewController | undefined;

/**
 * Show the post-scaffolding "what's next" view. Disposes any open
 * loading view first so the next-steps panel takes its place.
 */
export function openScaffoldNextStepsView(config: Record<string, never>): void {
    closeLoadingView();

    if (controller) {
        controller.updateConfig(config);
        controller.revealToForeground(vscode.ViewColumn.Active);
        return;
    }

    controller = new ScaffoldNextStepsViewController(config);
    controller.revealToForeground(vscode.ViewColumn.Active);
    controller.panel.onDidDispose(() => {
        controller = undefined;
    });
}

export function isScaffoldNextStepsViewOpen(): boolean {
    return controller !== undefined;
}
