/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { parseDeploymentPlanMarkdown } from "../views/utils/parseDeploymentPlanMarkdown";
import { DeploymentPlanViewController, type DeploymentPlanViewStrings } from "./controllers/DeploymentPlanViewController";

let currentDeploymentPlanViewController: DeploymentPlanViewController | undefined;
let currentDeploymentPlanWatcher: vscode.Disposable | undefined;

function getDeploymentPlanViewStrings(): DeploymentPlanViewStrings {
    return {
        title: vscode.l10n.t('Azure Deployment Plan'),
        loading: vscode.l10n.t('Loading deployment plan...'),
        subscriptionLabel: vscode.l10n.t('Subscription'),
        locationLabel: vscode.l10n.t('Location'),
        selectSubscriptionPlaceholder: vscode.l10n.t('Select a subscription...'),
        selectLocationPlaceholder: vscode.l10n.t('Select a location...'),
        architectureDiagramHeading: vscode.l10n.t('Architecture Diagram'),
        workspaceScanHeading: vscode.l10n.t('Workspace Scan'),
        decisionsHeading: vscode.l10n.t('Decisions'),
        azureResourcesHeading: vscode.l10n.t('Azure Resources'),
        approveButton: vscode.l10n.t('Approve'),
        feedbackButtonAriaLabel: vscode.l10n.t('Feedback'),
        revisingBanner: vscode.l10n.t('Copilot is revising the plan…'),
        requestChangesHeading: vscode.l10n.t('Request changes'),
        feedbackDrawerAriaLabel: vscode.l10n.t('Plan feedback'),
        closeFeedbackAriaLabel: vscode.l10n.t('Close feedback'),
        drawerHint: vscode.l10n.t('Change a SKU in the Azure Resources table to capture a suggested edit here, or add a free-form note below.'),
        freeformPlaceholder: vscode.l10n.t('Add a note for Copilot (e.g. "Use a Premium plan for the Functions App")'),
        addNoteButton: vscode.l10n.t('Add note'),
        discardAllButton: vscode.l10n.t('Discard all'),
        submitFeedbackButton: vscode.l10n.t('Submit feedback'),
        removeFeedbackItemAriaLabel: vscode.l10n.t('Remove feedback item'),
        submitEditsDialogTitle: vscode.l10n.t('Submit edits to Copilot?'),
        pendingEditsSingularMessage: vscode.l10n.t('You have {0} pending edit. Would you like to submit it to Copilot to revise the plan?'),
        pendingEditsPluralMessage: vscode.l10n.t('You have {0} pending edits. Would you like to submit them to Copilot to revise the plan?'),
        editsMadeFallbackMessage: vscode.l10n.t('Edits were made. Would you like to submit those edits to Copilot?'),
        cancelButton: vscode.l10n.t('Cancel'),
        submitEditsButton: vscode.l10n.t('Submit'),
        noDiagramAvailable: vscode.l10n.t('No diagram available'),
    };
}

export function isDeploymentPlanViewOpen(): boolean {
    return currentDeploymentPlanViewController !== undefined;
}

export function openDeploymentPlanView(uri: vscode.Uri): void {
    void openDeploymentPlanViewAsync(uri);
}

export function openDeploymentPlanViewWithContent(content: string): void {
    const planData = parseDeploymentPlanMarkdown(content);

    if (currentDeploymentPlanViewController) {
        currentDeploymentPlanViewController.updateDeploymentPlanData(planData);
        currentDeploymentPlanViewController.revealToForeground(vscode.ViewColumn.Active);
        return;
    }

    currentDeploymentPlanViewController = new DeploymentPlanViewController(planData, getDeploymentPlanViewStrings());
    currentDeploymentPlanViewController.revealToForeground(vscode.ViewColumn.Active);
    currentDeploymentPlanViewController.panel.onDidDispose(() => {
        currentDeploymentPlanViewController = undefined;
        currentDeploymentPlanWatcher?.dispose();
        currentDeploymentPlanWatcher = undefined;
    });
}

export async function openDeploymentPlanViewFromWorkspace(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/.azure/plan.md', '**/node_modules/**', 10);
    if (files.length === 0) {
        void vscode.window.showInformationMessage(vscode.l10n.t('No deployment plan markdown files found in the workspace.'));
        return;
    }

    let selected: vscode.Uri;
    if (files.length === 1) {
        selected = files[0];
    } else {
        const picked = await vscode.window.showQuickPick(
            files.map((f) => ({ label: vscode.workspace.asRelativePath(f), uri: f })),
            { placeHolder: vscode.l10n.t('Select a deployment plan file to open') },
        );
        if (!picked) {
            return;
        }
        selected = picked.uri;
    }

    await openDeploymentPlanViewAsync(selected);
}

async function openDeploymentPlanViewAsync(uri: vscode.Uri): Promise<void> {
    const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
    openDeploymentPlanViewWithContent(content);
    watchDeploymentPlanFile(uri);
}

/**
 * Watch the deployment plan markdown file so the webview auto-refreshes when
 * Copilot finishes revising it on disk.
 */
function watchDeploymentPlanFile(uri: vscode.Uri): void {
    currentDeploymentPlanWatcher?.dispose();

    const pattern = new vscode.RelativePattern(
        vscode.Uri.file(uri.fsPath.replace(/[/\\][^/\\]+$/, '')),
        uri.fsPath.replace(/^.*[/\\]/, ''),
    );
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const reload = async () => {
        try {
            const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
            openDeploymentPlanViewWithContent(content);
        } catch {
            // File may have been deleted or be momentarily unavailable; ignore.
        }
    };
    watcher.onDidChange(() => void reload());
    watcher.onDidCreate(() => void reload());
    currentDeploymentPlanWatcher = watcher;
}
