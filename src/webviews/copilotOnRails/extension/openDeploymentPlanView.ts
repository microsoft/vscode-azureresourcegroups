/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ext } from "../../../extensionVariables";
import type { DeploymentPlanData } from "../views/utils/deploymentPlanTypes";
import { parseDeploymentPlanMarkdown } from "../views/utils/parseDeploymentPlanMarkdown";
import { DeploymentPlanViewController } from "./controllers/DeploymentPlanViewController";
import { closeLoadingView } from "./openLoadingView";
import { buildParseError, pickWorkspaceFile, readFileText, SingletonViewHost, watchSingleFile } from "./utils/singletonViewHost";

const host = new SingletonViewHost<DeploymentPlanData, DeploymentPlanViewController>({
    createController: (data, uri) => {
        closeLoadingView();
        return new DeploymentPlanViewController(data, uri);
    },
    updateController: (controller, data, uri) => controller.updateDeploymentPlanData(data, uri),
});

export function isDeploymentPlanViewOpen(): boolean {
    return host.isOpen;
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

    host.show(planData, sourceFileUri);
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
            parseError: buildParseError(
                errorMessage ?? vscode.l10n.t('The deployment plan couldn\u2019t be rendered as a structured view. The generated markdown didn\u2019t match the expected layout.'),
                sourceFileUri,
            ),
        };
    }
    return parsed;
}

export async function openDeploymentPlanViewFromWorkspace(): Promise<void> {
    const selected = await pickWorkspaceFile(
        '.azure/deployment-plan.md',
        vscode.l10n.t('No deployment plan markdown files found in the workspace.'),
    );
    if (selected) {
        await openDeploymentPlanViewAsync(selected);
    }
}

async function openDeploymentPlanViewAsync(uri: vscode.Uri): Promise<void> {
    openDeploymentPlanViewWithContent(await readFileText(uri), uri);
    host.setWatcher(watchSingleFile(uri, () => void reloadDeploymentPlan(uri)));
}

async function reloadDeploymentPlan(uri: vscode.Uri): Promise<void> {
    try {
        openDeploymentPlanViewWithContent(await readFileText(uri), uri);
    } catch {
        // File may have been deleted or be momentarily unavailable; ignore.
    }
}
