/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { copilotOnRailsCommandIds } from "../../../commands/copilotOnRails/registerCopilotOnRailsCommands";
import { ext } from "../../../extensionVariables";
import { type LoadingViewConfiguration } from "../views/utils/viewConfigTypes";
import { LoadingViewController } from "./controllers/LoadingViewController";

let controller: LoadingViewController | undefined;

/**
 * The config the loading view was last shown with, kept so the progress surface
 * can be reopened after the user closes its tab early.
 */
let lastConfig: LoadingViewConfiguration | undefined;

/**
 * True while {@link closeLoadingView} is disposing the panel, so the dispose
 * handler can tell a programmatic phase hand-off apart from the user closing the
 * progress tab themselves.
 */
let closingProgrammatically = false;

/** Status-bar affordance offering to reopen the progress view after an early close. */
let reopenStatusBarItem: vscode.StatusBarItem | undefined;

/**
 * Show or update the transient loading view used to bridge workflow steps
 */
export function openLoadingView(config: LoadingViewConfiguration): void {
    lastConfig = config;
    hideReopenAffordance();

    if (controller) {
        controller.updateConfig(config);
        controller.revealToForeground(vscode.ViewColumn.Active);
        return;
    }

    controller = new LoadingViewController(config);
    controller.revealToForeground(vscode.ViewColumn.Active);
    controller.panel.onDidDispose(() => {
        controller = undefined;
        // A dispose we didn't initiate means the user closed the progress tab
        // while work was still in flight. Surface a one-click way back instead
        // of stranding them with no visible progress.
        if (!closingProgrammatically) {
            showReopenAffordance();
        }
    });
}

/** Dispose the loading view, if any. Safe to call when no loading view is open. */
export function closeLoadingView(): void {
    closingProgrammatically = true;
    try {
        controller?.panel.dispose();
    } finally {
        closingProgrammatically = false;
    }
    controller = undefined;
    // A programmatic close means the flow moved on to its next surface, so the
    // progress view is intentionally gone — drop the reopen affordance and the
    // stale config it would reopen.
    lastConfig = undefined;
    hideReopenAffordance();
}

export function isLoadingViewOpen(): boolean {
    return controller !== undefined;
}

/**
 * Reopens the progress view with the config it last displayed. Backs the
 * "Show Copilot progress" affordance shown after an early close. No-op when
 * there is nothing to reopen.
 */
export function reopenLoadingView(): void {
    if (lastConfig) {
        openLoadingView(lastConfig);
    }
}

function showReopenAffordance(): void {
    if (!lastConfig) {
        return;
    }
    if (!reopenStatusBarItem) {
        reopenStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
        reopenStatusBarItem.command = copilotOnRailsCommandIds.showProgressView;
        reopenStatusBarItem.text = `$(loading~spin) ${vscode.l10n.t('Show Copilot progress')}`;
        reopenStatusBarItem.tooltip = vscode.l10n.t('Reopen the Copilot progress view you closed');
        ext.context.subscriptions.push(reopenStatusBarItem);
    }
    reopenStatusBarItem.show();
}

function hideReopenAffordance(): void {
    reopenStatusBarItem?.hide();
}
