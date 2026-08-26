/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ensureAgentInstructions } from "../../../../commands/copilotOnRails/agentInstructions";
import { buildChatOpenOptions } from "../../../../commands/copilotOnRails/openChatWithAgent";
import { azureDebugPlanAgent } from "../../../../constants";
import { ext } from "../../../../extensionVariables";
import { CopilotOnRailsContext } from "../../../../utils/copilotOnRails/CopilotOnRailsContext";
import { callWithDiagnosticsAndTelemetryHandling, corId, setCorProp } from "../../../../utils/copilotOnRails/telemetryUtils";
import { type LocalPlanData } from "../../views/utils/parseLocalDebugPlanMarkdown";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";
import { armDebugPlanImplementedWatcher } from "../debugPlanImplementedWatcher";
import { openLoadingView } from "../openLoadingView";
import { suppressTrackedViewCloseOnce } from "../projectSession";
import { openSourceFileOrWarn } from "../utils/singletonViewHost";
import { CopilotOnRailsWebviewController } from "./CopilotOnRailsWebviewController";

export class LocalPlanViewController extends CopilotOnRailsWebviewController<Record<string, never>> {
    private sourceFileUri: vscode.Uri | undefined;
    private _isRefreshingPrereqs = false;
    private _refreshPrereqsTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(planData: LocalPlanData, sourceFileUri?: vscode.Uri) {
        super(ext.context, 'Local Dev Plan', 'localPlanView', {}, ViewColumn.Active, undefined, getCopilotOnRailsBundleLocation());

        this.sourceFileUri = sourceFileUri;

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
        return await callWithTelemetryAndErrorHandling(corId('submitDebugPlanApproval'), async (actionContext: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(actionContext, { type: 'webviewAction', name: 'submitDebugPlanApproval' }, async (context: CopilotOnRailsContext) => {
                if (!(await this.trySubmitPlanApproval(context))) {
                    return;
                }

                suppressTrackedViewCloseOnce();
                await armDebugPlanImplementedWatcher();
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

    private async trySubmitPlanApproval(context: CopilotOnRailsContext): Promise<boolean> {
        const approvalOutcomeKey = 'approvalOutcome';
        await ensureAgentInstructions(context, azureDebugPlanAgent);

        // Fresh chat session for the approval hand-off so the next phase starts with a
        // clean context window.
        await vscode.commands.executeCommand('workbench.action.chat.newChat');
        await vscode.commands.executeCommand('workbench.action.chat.open', await buildChatOpenOptions(context, {
            mode: azureDebugPlanAgent,
            query: 'I approve the debug setup plan.',
        }));

        setCorProp(context, approvalOutcomeKey, 'submitted');
        return true;
    }

    private async trySubmitPlanFeedback(query: string): Promise<boolean> {
        const feedbackOutcomeKey = 'feedbackOutcome';
        return await callWithTelemetryAndErrorHandling(corId('submitDebugPlanFeedback'), async (actionContext: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(actionContext, { type: 'webviewAction', name: 'submitDebugPlanFeedback' }, async (context: CopilotOnRailsContext) => {
                await ensureAgentInstructions(context, azureDebugPlanAgent);

                // Reuse the current session so the agent iterates on the plan with the existing conversation.
                await vscode.commands.executeCommand('workbench.action.chat.open', await buildChatOpenOptions(context, {
                    mode: azureDebugPlanAgent,
                    query,
                }));
                void this.panel.webview.postMessage({ command: 'revisionInProgress' });

                setCorProp(context, feedbackOutcomeKey, 'submitted');
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
        await callWithTelemetryAndErrorHandling(corId('refreshDebugPrerequisites'), async (actionContext: IActionContext) => {
            actionContext.errorHandling.suppressDisplay = true;
            await callWithDiagnosticsAndTelemetryHandling(actionContext, { type: 'webviewAction', name: 'refreshDebugPrerequisites' }, async (context: CopilotOnRailsContext) => {
                const refreshOutcomeKey = 'refreshOutcome';
                await ensureAgentInstructions(context, azureDebugPlanAgent);

                this._isRefreshingPrereqs = true;
                void this.panel.webview.postMessage({ command: 'prerequisitesRefreshing' });
                await vscode.commands.executeCommand('workbench.action.chat.open', await buildChatOpenOptions(context, {
                    mode: azureDebugPlanAgent,
                    query: 'Re-check the prerequisites section only. Re-run the installed/version checks for every tool and extension in the Prerequisites table and update the plan file with the current results.',
                }));

                setCorProp(context, refreshOutcomeKey, 'submitted');
                if (this._refreshPrereqsTimer) {
                    clearTimeout(this._refreshPrereqsTimer);
                }
                this._refreshPrereqsTimer = setTimeout(() => {
                    this._refreshPrereqsTimer = undefined;
                    this.clearPrereqsRefresh();
                }, 15_000);
            });
        });
    }

    updatePlanData(planData: LocalPlanData, sourceFileUri?: vscode.Uri): void {
        if (sourceFileUri) {
            this.sourceFileUri = sourceFileUri;
        }
        void this.panel.webview.postMessage({ command: 'setLocalPlanData', data: planData });
        void this.panel.webview.postMessage({ command: 'revisionComplete' });
        this.clearPrereqsRefresh();
    }
}
