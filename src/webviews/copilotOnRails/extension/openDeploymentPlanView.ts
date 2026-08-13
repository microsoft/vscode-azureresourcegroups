/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LocationListStep } from "@microsoft/vscode-azext-azureutils";
import { callWithTelemetryAndErrorHandling, createSubscriptionContext, IActionContext, ISubscriptionActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { ext } from "../../../extensionVariables";
import { DEPLOYMENT_PLAN_FILE_GLOB } from "../../../tree/project/projectPlanFiles";
import { CopilotOnRailsContext } from "../../../utils/copilotOnRails/CopilotOnRailsContext";
import { corId } from "../../../utils/copilotOnRails/telemetryUtils";
import type { DeploymentPlanData } from "../views/utils/deploymentPlanTypes";
import { getDeploymentPlanRenderIssue, parseDeploymentPlanMarkdown } from "../views/utils/parseDeploymentPlanMarkdown";
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
    const [liveSubscriptions, liveLocations] = await Promise.all([
        getAvailableAzureSubscriptions(),
        getAvailableAzureLocations(),
    ]);
    if (liveSubscriptions) {
        planData.availableSubscriptions = liveSubscriptions;
    }
    if (liveLocations) {
        planData.availableLocations = liveLocations;
        // Resolve the location code from the display name when the plan omitted it.
        if (!planData.locationCode && planData.location) {
            const needle = planData.location.toLowerCase();
            const matched = liveLocations.find(l => l.name.toLowerCase() === needle || l.code.toLowerCase() === needle);
            if (matched) {
                planData.locationCode = matched.code;
                planData.location = matched.name;
            }
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

async function getAvailableAzureLocations(): Promise<{ name: string; code: string }[] | undefined> {
    return await callWithTelemetryAndErrorHandling(corId('deploymentPlan.getLocations'), async (context: IActionContext) => {
        context.errorHandling.rethrow = false;
        context.telemetry.suppressIfSuccessful = true;

        const provider = await ext.subscriptionProviderFactory();
        const subscriptions = await provider.getAvailableSubscriptions({ filter: false });
        if (subscriptions.length === 0) {
            return undefined;
        }

        const wizardContext: ISubscriptionActionContext = { ...context, ...createSubscriptionContext(subscriptions[0]) };
        const locations = await LocationListStep.getLocations(wizardContext);
        const mapped = locations
            .map(l => ({ name: l.displayName ?? l.name, code: l.name }))
            .filter((l): l is { name: string; code: string } => Boolean(l.name && l.code));
        const unique = Array.from(new Map(mapped.map(l => [l.code, l])).values())
            .sort((a, b) => a.name.localeCompare(b.name));
        return unique.length > 0 ? unique : undefined;
    });
}

function tryParseDeploymentPlan(content: string, sourceFileUri: vscode.Uri | undefined): DeploymentPlanData {
    let parsed: DeploymentPlanData | undefined;
    let errorMessage: string | undefined;
    try {
        parsed = parseDeploymentPlanMarkdown(content);
    } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
    }

    const renderIssue = parsed ? getDeploymentPlanRenderIssue(content, parsed) : undefined;
    if (errorMessage || !parsed || renderIssue) {
        const renderIssueMessage = renderIssue === 'empty'
            ? vscode.l10n.t('The deployment plan file is empty. Copilot may still be generating it. This view will reload automatically when the file changes.')
            : vscode.l10n.t('The deployment plan doesn\u2019t contain a supported structured section yet. Add a markdown table under Components Detected, Architecture, Decisions, Azure Resources, or Service Mapping. This view will reload automatically when the file changes.');
        return {
            status: parsed?.status ?? 'Unknown',
            mode: parsed?.mode ?? 'Unknown',
            subscription: parsed?.subscription ?? '',
            availableSubscriptions: parsed?.availableSubscriptions,
            location: parsed?.location ?? '',
            locationCode: parsed?.locationCode ?? '',
            availableLocations: parsed?.availableLocations,
            architecture: parsed?.architecture ?? [],
            workspaceScan: parsed?.workspaceScan ?? { headers: [], rows: [] },
            decisions: parsed?.decisions ?? { headers: [], rows: [] },
            resources: parsed?.resources ?? { headers: [], rows: [] },
            requirements: parsed?.requirements,
            recipe: parsed?.recipe,
            stack: parsed?.stack,
            parseError: buildParseError(
                errorMessage ?? renderIssueMessage,
                sourceFileUri,
            ),
        };
    }
    return parsed;
}

export async function openDeploymentPlanViewFromWorkspace(_context: CopilotOnRailsContext): Promise<void> {
    const selected = await pickWorkspaceFile(
        DEPLOYMENT_PLAN_FILE_GLOB,
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
