/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ensureAgentInstructions } from "../../../../commands/copilotOnRails/agentInstructions";
import { azureDebugPlanAgent } from "../../../../constants";
import { ext } from "../../../../extensionVariables";
import { type LocalPlanData } from "../../views/utils/parseLocalPlanMarkdown";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";
import { openLoadingView } from "../openLoadingView";
import { openSourceFileOrWarn } from "../utils/singletonViewHost";

export class LocalPlanViewController extends WebviewController<Record<string, never>> {
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
                    void this.approveAndOpenDebugPlanChat();
                    break;
                case 'submitPlanFeedback': {
                    const query = message.prompt?.trim();
                    if (!query) {
                        return;
                    }
                    void this.openDebugPlanChat(query, true);
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

    private async approveAndOpenDebugPlanChat(): Promise<void> {
        if (!(await this.openDebugPlanChat('I approve the debug setup plan.', false))) {
            return;
        }
        this.panel.dispose();
        openLoadingView({
            stage: 1,
            title: vscode.l10n.t('Setting up your local development environment…'),
            message: vscode.l10n.t('Copilot is setting your project up for local development'),
        });
    }

    private async openDebugPlanChat(query: string, isFeedback: boolean): Promise<boolean> {
        if (!(await ensureAgentInstructions(azureDebugPlanAgent))) {
            return false;
        }
        if (!isFeedback) {
            // Fresh chat session for the approval hand-off so the next phase starts with a
            // clean context window. Feedback/revision stays in the current session because
            // it iterates on the plan with the existing conversation.
            await vscode.commands.executeCommand('workbench.action.chat.newChat');
        }
        await vscode.commands.executeCommand('workbench.action.chat.open', {
            mode: azureDebugPlanAgent,
            query,
        });
        if (isFeedback) {
            void this.panel.webview.postMessage({ command: 'revisionInProgress' });
        }
        return true;
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
        if (!(await ensureAgentInstructions(azureDebugPlanAgent))) {
            return;
        }
        this._isRefreshingPrereqs = true;
        void this.panel.webview.postMessage({ command: 'prerequisitesRefreshing' });
        await vscode.commands.executeCommand('workbench.action.chat.open', {
            mode: azureDebugPlanAgent,
            query: 'Re-check the prerequisites section only. Re-run the installed/version checks for every tool and extension in the Prerequisites table and update the plan file with the current results.',
        });
        if (this._refreshPrereqsTimer) {
            clearTimeout(this._refreshPrereqsTimer);
        }
        this._refreshPrereqsTimer = setTimeout(() => {
            this._refreshPrereqsTimer = undefined;
            this.clearPrereqsRefresh();
        }, 15_000);
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
