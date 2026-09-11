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
 * Set by the owner of the current progress session to take over what happens when the user
 * closes the tab themselves. Cleared whenever the session ends or is replaced.
 */
let userCloseHandler: (() => void) | undefined;

export type OpenLoadingViewOptions = {
    /**
     * Called instead of showing the "Show Copilot progress" affordance when the user closes the
     * progress tab while work is still in flight. Lets a phase that pushes live updates treat an
     * early close as "stop tracking" rather than "reopen later on a stale snapshot".
     */
    onUserClose?: () => void;
};

/**
 * Show or update the transient loading view used to bridge workflow steps
 */
export function openLoadingView(config: LoadingViewConfiguration, options?: OpenLoadingViewOptions): void {
    lastConfig = config;
    userCloseHandler = options?.onUserClose;
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
        if (closingProgrammatically) {
            return;
        }
        if (userCloseHandler) {
            const handler = userCloseHandler;
            userCloseHandler = undefined;
            handler();
            return;
        }
        showReopenAffordance();
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
    userCloseHandler = undefined;
    hideReopenAffordance();
}

export function isLoadingViewOpen(): boolean {
    return controller !== undefined;
}

/**
 * Refreshes the progress view's content in place, without ever creating a panel.
 *
 * Used by long-running phase watchers that push progress updates: if the user closed
 * the progress tab we still record the newest config so the "Show Copilot progress"
 * affordance reopens on the current state rather than a stale snapshot — but we don't
 * force a closed tab back open on every file write.
 *
 * @returns `true` when there was a tracked progress session to update.
 */
export function updateLoadingView(config: LoadingViewConfiguration): boolean {
    if (!lastConfig) {
        // No progress session in flight (or it already handed off) — nothing to refresh.
        return false;
    }
    lastConfig = config;
    controller?.updateConfig(config);
    return true;
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
        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
        statusBarItem.command = copilotOnRailsCommandIds.showProgressView;
        statusBarItem.text = `$(loading~spin) ${vscode.l10n.t('Show Copilot progress')}`;
        statusBarItem.tooltip = vscode.l10n.t('Reopen the Copilot progress view you closed');
        reopenStatusBarItem = statusBarItem;
        ext.context.subscriptions.push(statusBarItem, new vscode.Disposable(() => {
            if (reopenStatusBarItem === statusBarItem) {
                reopenStatusBarItem = undefined;
            }
        }));
    }
    reopenStatusBarItem.show();
}

function hideReopenAffordance(): void {
    reopenStatusBarItem?.hide();
}
