/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ext } from "../../../extensionVariables";
import type { DeploymentPlanData } from "../views/utils/deploymentPlanTypes";
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
        feedbackButtonTooltip: vscode.l10n.t('Request changes to the plan before approving'),
        approveButtonTooltip: vscode.l10n.t('Approve the plan and continue with Copilot'),
        approveButtonAlreadyApprovedTooltip: vscode.l10n.t('Plan already approved'),
        feedbackDrawerInfoTooltip: vscode.l10n.t('Your feedback will be sent to Copilot as a prompt. Copilot will revise the plan and update the file. The updated plan will reload here for your final approval.'),
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
        parseFailureTitle: vscode.l10n.t('We couldn\u2019t render this plan'),
        parseFailureFallbackMessage: vscode.l10n.t('The deployment plan couldn\u2019t be rendered as a structured view. The generated markdown didn\u2019t match the expected layout.'),
        parseFailureFileLabel: vscode.l10n.t('Plan file'),
        openPlanFileButton: vscode.l10n.t('Open plan file'),
    };
}

export function isDeploymentPlanViewOpen(): boolean {
    return currentDeploymentPlanViewController !== undefined;
}

export function openDeploymentPlanView(uri: vscode.Uri): void {
    void openDeploymentPlanViewAsync(uri);
}

export function openDeploymentPlanViewWithContent(content: string, sourceFileUri?: vscode.Uri): void {
    void openDeploymentPlanViewWithContentAsync(content, sourceFileUri);
}

async function openDeploymentPlanViewWithContentAsync(content: string, sourceFileUri?: vscode.Uri): Promise<void> {
    const planData = tryParseDeploymentPlan(content, sourceFileUri);
    const liveSubscriptions = await getAvailableAzureSubscriptions();
    if (liveSubscriptions) {
        planData.availableSubscriptions = liveSubscriptions;
        if (planData.subscription && !liveSubscriptions.includes(planData.subscription)) {
            planData.subscription = '';
        }
    }

    if (currentDeploymentPlanViewController) {
        currentDeploymentPlanViewController.updateDeploymentPlanData(planData, sourceFileUri);
        currentDeploymentPlanViewController.revealToForeground(vscode.ViewColumn.Active);
        return;
    }

    currentDeploymentPlanViewController = new DeploymentPlanViewController(planData, getDeploymentPlanViewStrings(), sourceFileUri);
    currentDeploymentPlanViewController.revealToForeground(vscode.ViewColumn.Active);
    currentDeploymentPlanViewController.panel.onDidDispose(() => {
        currentDeploymentPlanViewController = undefined;
        currentDeploymentPlanWatcher?.dispose();
        currentDeploymentPlanWatcher = undefined;
    });
}

async function getAvailableAzureSubscriptions(): Promise<string[] | undefined> {
    try {
        const provider = await ext.subscriptionProviderFactory();
        const subs = await provider.getAvailableSubscriptions({ filter: false });
        if (subs.length === 0) {
            return undefined;
        }
        return Array.from(new Set(subs.map(s => s.name))).sort((a, b) => a.localeCompare(b));
    } catch {
        return undefined;
    }
}

function tryParseDeploymentPlan(content: string, sourceFileUri: vscode.Uri | undefined): DeploymentPlanData {
    let parsed: DeploymentPlanData | undefined;
    let errorMessage: string | undefined;
    try {
        parsed = parseDeploymentPlanMarkdown(content);
    } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
    }

    if (errorMessage
        || !parsed
        || (parsed.resources.rows.length === 0
            && parsed.decisions.rows.length === 0
            && parsed.workspaceScan.rows.length === 0
            && !parsed.mermaidDiagram)) {
        return {
            status: parsed?.status ?? 'Unknown',
            mode: parsed?.mode ?? 'Unknown',
            subscription: parsed?.subscription ?? '',
            availableSubscriptions: parsed?.availableSubscriptions,
            location: parsed?.location ?? '',
            locationCode: parsed?.locationCode ?? '',
            availableLocations: parsed?.availableLocations,
            mermaidDiagram: parsed?.mermaidDiagram ?? '',
            workspaceScan: parsed?.workspaceScan ?? { headers: [], rows: [] },
            decisions: parsed?.decisions ?? { headers: [], rows: [] },
            resources: parsed?.resources ?? { headers: [], rows: [] },
            parseError: {
                message: errorMessage ?? vscode.l10n.t('The deployment plan couldn\u2019t be rendered as a structured view. The generated markdown didn\u2019t match the expected layout.'),
                fileLabel: sourceFileUri ? vscode.workspace.asRelativePath(sourceFileUri) : undefined,
            },
        };
    }
    return parsed;
}

export async function openDeploymentPlanViewFromWorkspace(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/.azure/deployment-plan.md', '**/node_modules/**', 10);
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
    openDeploymentPlanViewWithContent(content, uri);
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
            openDeploymentPlanViewWithContent(content, uri);
        } catch {
            // File may have been deleted or be momentarily unavailable; ignore.
        }
    };
    watcher.onDidChange(() => void reload());
    watcher.onDidCreate(() => void reload());
    currentDeploymentPlanWatcher = watcher;
}
