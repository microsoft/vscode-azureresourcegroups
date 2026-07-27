/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from "@microsoft/vscode-azext-utils";
import { WebviewController } from "@microsoft/vscode-azext-webview";
import { getCorProjectId } from "src/utils/copilotOnRails/telemetryUtils";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ensureAgentInstructions } from "../../../../commands/copilotOnRails/agentInstructions";
import { buildChatOpenOptions } from "../../../../commands/copilotOnRails/openChatWithAgent";
import { azureDebugPlanAgent } from "../../../../constants";
import { ext } from "../../../../extensionVariables";
import { CopilotOnRailsContext } from "../../../../utils/copilotOnRails/CopilotOnRailsContext";
import { callWithDiagnosticsAndTelemetryHandling, CopilotOnRailsPhase, corId, setCorProp } from "../../../../utils/copilotOnRails/telemetryUtils";
import { type LocalPlanData } from "../../views/utils/parseLocalDebugPlanMarkdown";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";
import { openLoadingView } from "../openLoadingView";
import { suppressTrackedViewCloseOnce } from "../projectSession";
import { getLocalDebugPlanTelemetry, LOCAL_DEBUG_PLAN_TELEMETRY_PREFIX } from "../utils/localDebugPlanTelemetryUtils";
import { openSourceFileOrWarn } from "../utils/singletonViewHost";

export class LocalPlanViewController extends WebviewController<Record<string, never>> {
    private readonly ensureAgentInstructionsKey = 'ensureAgentInstructions';
    private sourceFileUri: vscode.Uri | undefined;
    private planData: LocalPlanData;
    private _isRefreshingPrereqs = false;
    private _refreshPrereqsTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(planData: LocalPlanData, sourceFileUri?: vscode.Uri) {
        super(ext.context, 'Local Dev Plan', 'localPlanView', {}, ViewColumn.Active, undefined, getCopilotOnRailsBundleLocation());

        this.sourceFileUri = sourceFileUri;
        this.planData = planData;

        this.panel.webview.onDidReceiveMessage((message: { command: string; data?: LocalPlanData; prompt?: string }) => {
            switch (message.command) {
                case 'ready':
                    void this.panel.webview.postMessage({ command: 'setLocalPlanData', data: planData });
                    break;
                case 'approvePlan':
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
                case 'refreshPrerequisites':
                    void this.refreshPrerequisites();
                    break;
            }
        });
    }

    private async approvePlan(): Promise<void> {
        return await callWithTelemetryAndErrorHandling(corId('submitPlanApproval', CopilotOnRailsPhase.Debug), async (actionContext: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(actionContext, { type: 'webviewAction', name: 'submitDebugPlanApproval' }, async (context: CopilotOnRailsContext) => {
                if (!(await this.trySubmitPlanApproval(context))) {
                    return;
                }

                suppressTrackedViewCloseOnce();
                this.recordPlanTelemetry(context);
                this.panel.dispose();

                openLoadingView({
                    stage: 1,
                    title: vscode.l10n.t('Setting up your local development environment…'),
                    message: vscode.l10n.t('Copilot is setting your project up for local development'),
                    showNeedHelp: true,
                });
            });
        });
    }

    private recordPlanTelemetry(context: CopilotOnRailsContext): void {
        try {
            const telemetry = getLocalDebugPlanTelemetry(this.planData);
            for (const [key, value] of Object.entries(telemetry)) {
                setCorProp(context, `${LOCAL_DEBUG_PLAN_TELEMETRY_PREFIX}${key}`, value);
            }
        } catch {
            // Telemetry extraction must never block the approval flow; swallow any parsing errors.
            setCorProp(context, `${LOCAL_DEBUG_PLAN_TELEMETRY_PREFIX}parseFailed`, true);
        }
    }

    private async trySubmitPlanApproval(context: CopilotOnRailsContext): Promise<boolean> {
        if (!(await ensureAgentInstructions(azureDebugPlanAgent))) {
            setCorProp(context, this.ensureAgentInstructionsKey, false);
            setCorProp(context, 'approvalOutcome', 'agentInstructionsMissing');
            return false;
        }

        // Fresh chat session for the approval hand-off so the next phase starts with a
        // clean context window.
        await vscode.commands.executeCommand('workbench.action.chat.newChat');
        await vscode.commands.executeCommand('workbench.action.chat.open', await buildChatOpenOptions({
            mode: azureDebugPlanAgent,
            query: 'I approve the debug setup plan.',
        }));

        setCorProp(context, this.ensureAgentInstructionsKey, true);
        setCorProp(context, 'approvalOutcome', 'submitted');
        return true;
    }

    private async trySubmitPlanFeedback(query: string): Promise<boolean> {
        return await callWithTelemetryAndErrorHandling(corId('submitPlanFeedback', CopilotOnRailsPhase.Debug), async (actionContext: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(actionContext, { type: 'webviewAction', name: 'submitDebugPlanFeedback' }, async (context: CopilotOnRailsContext) => {
                if (!(await ensureAgentInstructions(azureDebugPlanAgent))) {
                    setCorProp(context, this.ensureAgentInstructionsKey, false);
                    setCorProp(context, 'feedbackOutcome', 'agentInstructionsMissing');
                    return false;
                }

                // Reuse the current session so the agent iterates on the plan with the existing conversation.
                await vscode.commands.executeCommand('workbench.action.chat.open', await buildChatOpenOptions({
                    mode: azureDebugPlanAgent,
                    query,
                }));
                void this.panel.webview.postMessage({ command: 'revisionInProgress' });

                setCorProp(context, this.ensureAgentInstructionsKey, true);
                setCorProp(context, 'feedbackOutcome', 'submitted');
                return true;
            });
        }) ?? false;
    }

    private clearPrereqsRefresh(): void {
        if (this._refreshPrereqsTimer) {
            clearTimeout(this._refreshPrereqsTimer);
            this._refreshPrereqsTimer = undefined;
        }
        if (this._isRefreshingPrereqs) {
            this._isRefreshingPrereqs = false;
            void this.panel.webview.postMessage({ command: 'prerequisitesRefreshComplete' });
        }
    }

    private async refreshPrerequisites(): Promise<void> {
        await callWithTelemetryAndErrorHandling(corId('refreshPrerequisites', CopilotOnRailsPhase.Debug), async (context: IActionContext) => {
            context.telemetry.properties.isCopilotEvent = 'true';
            context.telemetry.properties.corProjectId = getCorProjectId();
            context.errorHandling.suppressDisplay = true;

            if (!(await ensureAgentInstructions(azureDebugPlanAgent))) {
                return;
            }
            this._isRefreshingPrereqs = true;
            void this.panel.webview.postMessage({ command: 'prerequisitesRefreshing' });
            await vscode.commands.executeCommand('workbench.action.chat.open', await buildChatOpenOptions({
                mode: azureDebugPlanAgent,
                query: 'Re-check the prerequisites section only. Re-run the installed/version checks for every tool and extension in the Prerequisites table and update the plan file with the current results.',
            }));
            if (this._refreshPrereqsTimer) {
                clearTimeout(this._refreshPrereqsTimer);
            }
            this._refreshPrereqsTimer = setTimeout(() => {
                this._refreshPrereqsTimer = undefined;
                this.clearPrereqsRefresh();
            }, 15_000);
        });
    }

    updatePlanData(planData: LocalPlanData, sourceFileUri?: vscode.Uri): void {
        this.planData = planData;
        if (sourceFileUri) {
            this.sourceFileUri = sourceFileUri;
        }
        void this.panel.webview.postMessage({ command: 'setLocalPlanData', data: planData });
        void this.panel.webview.postMessage({ command: 'revisionComplete' });
        this.clearPrereqsRefresh();
    }
}
