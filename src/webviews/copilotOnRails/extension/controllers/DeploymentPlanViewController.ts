/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from "@microsoft/vscode-azext-utils";
import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ensureAgentInstructions } from "../../../../commands/copilotOnRails/agentInstructions";
import { buildChatOpenOptions } from "../../../../commands/copilotOnRails/openChatWithAgent";
import { azureDeployAgent } from "../../../../constants";
import { ext } from "../../../../extensionVariables";
import { CopilotOnRailsContext } from "../../../../utils/copilotOnRails/CopilotOnRailsContext";
import { callWithDiagnosticsAndTelemetryHandling, corId, setCorProp } from "../../../../utils/copilotOnRails/telemetryUtils";
import { type DeploymentPlanData } from "../../views/utils/deploymentPlanTypes";
import { type DeploymentPlanViewConfiguration, type DeploymentPlanViewStrings } from "../../views/utils/viewConfigTypes";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";
import { DEPLOYMENT_PLAN_TELEMETRY_PREFIX, getDeploymentPlanTelemetry } from "../utils/deploymentPlanTelemetryUtils";
import { openSourceFileOrWarn } from "../utils/singletonViewHost";

export type { DeploymentPlanViewConfiguration, DeploymentPlanViewStrings };

/** Localized strings rendered by the deployment plan webview. */
function getDeploymentPlanViewStrings(): DeploymentPlanViewStrings {
    return {
        title: vscode.l10n.t('Azure Deployment Plan'),
        loading: vscode.l10n.t('Loading deployment plan...'),
        locationLabel: vscode.l10n.t('Location'),
        selectLocationPlaceholder: vscode.l10n.t('Select a location...'),
        locationsSignedOutHint: vscode.l10n.t('Sign in to Azure to pick a different region.'),
        locationsFailedHint: vscode.l10n.t('Couldn\u2019t load Azure regions \u2014 showing the planned region only.'),
        azureResourcesHeading: vscode.l10n.t('Azure Resources'),
        costEstimateHeading: vscode.l10n.t('Cost Estimate'),
        costEstimateTotalLabel: vscode.l10n.t('Estimated monthly total'),
        costServiceHeader: vscode.l10n.t('Service'),
        costSkuHeader: vscode.l10n.t('SKU'),
        costMonthlyHeader: vscode.l10n.t('Monthly'),
        costNotesHeader: vscode.l10n.t('Notes'),
        recommendationsHeading: vscode.l10n.t('Post-Deploy Recommendations'),
        recommendationEffortLabel: vscode.l10n.t('Effort'),
        environmentNameLabel: vscode.l10n.t('Environment'),
        estimatedCostLabel: vscode.l10n.t('Estimated cost'),
        approveButton: vscode.l10n.t('Approve Plan'),
        feedbackButtonAriaLabel: vscode.l10n.t('Feedback'),
        feedbackButtonTooltip: vscode.l10n.t('Request changes to the plan before approving'),
        approveButtonTooltip: vscode.l10n.t('Approve the plan and continue with Copilot'),
        approveButtonMissingSelectionTooltip: vscode.l10n.t('Select a location before approving the plan'),
        feedbackDrawerInfoTooltip: vscode.l10n.t('Your feedback will be sent to Copilot as a prompt. Copilot will revise the plan and update the file. The updated plan will reload here for your final approval.'),
        revisingBanner: vscode.l10n.t('Copilot is revising the plan…'),
        requestChangesHeading: vscode.l10n.t('Request changes'),
        feedbackDrawerAriaLabel: vscode.l10n.t('Plan feedback'),
        closeFeedbackAriaLabel: vscode.l10n.t('Close feedback'),
        drawerHint: vscode.l10n.t('Change a SKU in the Azure Resources table to capture a suggested edit here, or add a free-form note below.'),
        freeformPlaceholder: vscode.l10n.t('Add a note for Copilot (e.g. "Use a Premium plan for the Functions App")'),
        addNoteButton: vscode.l10n.t('Add note'),
        discardAllButton: vscode.l10n.t('Discard all'),
        submitFeedbackButton: vscode.l10n.t('Submit'),
        removeFeedbackItemAriaLabel: vscode.l10n.t('Remove feedback item'),
        submitEditsDialogTitle: vscode.l10n.t('Submit edits to Copilot?'),
        pendingEditsSingularMessage: vscode.l10n.t('You have {0} pending edit. Would you like to submit it to Copilot to revise the plan?'),
        pendingEditsPluralMessage: vscode.l10n.t('You have {0} pending edits. Would you like to submit them to Copilot to revise the plan?'),
        editsMadeFallbackMessage: vscode.l10n.t('Edits were made. Would you like to submit those edits to Copilot?'),
        cancelButton: vscode.l10n.t('Cancel'),
        submitEditsButton: vscode.l10n.t('Submit'),
        parseFailureTitle: vscode.l10n.t('We couldn\u2019t render this plan'),
        parseFailureFallbackMessage: vscode.l10n.t('The deployment plan couldn\u2019t be rendered as a structured view. The generated plan file didn\u2019t match the expected layout.'),
        parseFailureFileLabel: vscode.l10n.t('Plan file'),
        openPlanFileButton: vscode.l10n.t('Open plan file'),
    };
}

export class DeploymentPlanViewController extends WebviewController<DeploymentPlanViewConfiguration> {
    private planData: DeploymentPlanData;
    private sourceFileUri: vscode.Uri | undefined;

    constructor(planData: DeploymentPlanData, sourceFileUri?: vscode.Uri) {
        const strings = getDeploymentPlanViewStrings();
        super(ext.context, strings.title, 'deploymentPlanView', { strings }, ViewColumn.Active, undefined, getCopilotOnRailsBundleLocation());

        this.planData = planData;
        this.sourceFileUri = sourceFileUri;

        void this.postDeploymentPlanData();

        this.panel.webview.onDidReceiveMessage((message: { command: string; data?: unknown; prompt?: string }) => {
            switch (message.command) {
                case 'ready':
                    void this.postDeploymentPlanData();
                    break;
                case 'approve':
                    void this.approvePlan();
                    break;
                case 'submitPlanFeedback': {
                    const query = message.prompt?.trim();
                    if (!query) {
                        return;
                    }
                    void this.trySubmitPlanFeedback(query);
                    break;
                }
                case 'openSourceFile':
                    openSourceFileOrWarn(this.sourceFileUri);
                    break;
            }
        });
    }

    private async approvePlan(): Promise<void> {
        await callWithTelemetryAndErrorHandling(corId('submitDeploymentPlanApproval'), async (actionContext: IActionContext) => {
            await callWithDiagnosticsAndTelemetryHandling(actionContext, { type: 'webviewAction', name: 'submitDeploymentPlanApproval' }, async (context: CopilotOnRailsContext) => {
                if (!(await this.trySubmitPlanApproval(context))) {
                    return;
                }

                this.recordPlanTelemetry(context);
                this.panel.dispose();
            });
        });
    }

    private recordPlanTelemetry(context: CopilotOnRailsContext): void {
        try {
            const telemetry = getDeploymentPlanTelemetry(this.planData);
            for (const [key, value] of Object.entries(telemetry)) {
                setCorProp(context, `${DEPLOYMENT_PLAN_TELEMETRY_PREFIX}${key}`, value);
            }
        } catch {
            // Telemetry extraction must never block the approval flow; swallow any parsing errors.
            setCorProp(context, `${DEPLOYMENT_PLAN_TELEMETRY_PREFIX}parseFailed`, true);
        }
    }

    private async trySubmitPlanApproval(context: CopilotOnRailsContext): Promise<boolean> {
        const approvalOutcomeKey = 'approvalOutcome';
        if (!(await ensureAgentInstructions(context, azureDeployAgent))) {
            setCorProp(context, approvalOutcomeKey, 'agentInstructionsMissing');
            return false;
        }

        // Fresh chat session for the approval hand-off so the next phase starts with a clean context window.
        await vscode.commands.executeCommand('workbench.action.chat.newChat');
        await vscode.commands.executeCommand('workbench.action.chat.open', await buildChatOpenOptions(context, {
            mode: azureDeployAgent,
            query: 'I approve the deployment plan. Continue with generating the infrastructure and deployment artifacts.',
        }));

        setCorProp(context, approvalOutcomeKey, 'submitted');
        return true;
    }

    private async trySubmitPlanFeedback(query: string): Promise<boolean> {
        return await callWithTelemetryAndErrorHandling(corId('submitDeploymentPlanFeedback'), async (actionContext: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(actionContext, { type: 'webviewAction', name: 'submitDeploymentPlanFeedback' }, async (context: CopilotOnRailsContext) => {
                const feedbackOutcomeKey = 'feedbackOutcome';
                if (!(await ensureAgentInstructions(context, azureDeployAgent))) {
                    setCorProp(context, feedbackOutcomeKey, 'agentInstructionsMissing');
                    return false;
                }

                // Reuse the current session so the agent iterates on the plan with the existing conversation.
                await vscode.commands.executeCommand('workbench.action.chat.open', await buildChatOpenOptions(context, {
                    mode: azureDeployAgent,
                    query,
                }));
                void this.panel.webview.postMessage({ command: 'revisionInProgress' });

                setCorProp(context, feedbackOutcomeKey, 'submitted');
                return true;
            });
        }) ?? false;
    }

    updateDeploymentPlanData(planData: DeploymentPlanData, sourceFileUri?: vscode.Uri): void {
        this.planData = planData;
        if (sourceFileUri) {
            this.sourceFileUri = sourceFileUri;
        }
        void this.postDeploymentPlanData();
        void this.panel.webview.postMessage({ command: 'revisionComplete' });
    }

    private async postDeploymentPlanData(): Promise<void> {
        await this.panel.webview.postMessage({ command: 'setDeploymentPlanData', data: this.planData });
    }
}
