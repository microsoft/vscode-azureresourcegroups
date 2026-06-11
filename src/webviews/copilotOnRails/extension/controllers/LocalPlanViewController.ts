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
import { openSourceFileOrWarn } from "../utils/singletonViewHost";

export class LocalPlanViewController extends WebviewController<Record<string, never>> {
    private sourceFileUri: vscode.Uri | undefined;

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
            }
        });
    }

    private async approveAndOpenDebugPlanChat(): Promise<void> {
        if (!(await this.openDebugPlanChat('I approve the debug setup plan.', false))) {
            return;
        }
        this.panel.dispose();
    }

    private async openDebugPlanChat(query: string, isFeedback: boolean): Promise<boolean> {
        try {
            await ensureAgentInstructions(azureDebugPlanAgent);
        } catch {
            // User declined to download required instructions — abort the hand-off.
            return false;
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

    updatePlanData(planData: LocalPlanData, sourceFileUri?: vscode.Uri): void {
        if (sourceFileUri) {
            this.sourceFileUri = sourceFileUri;
        }
        void this.panel.webview.postMessage({ command: 'setLocalPlanData', data: planData });
        void this.panel.webview.postMessage({ command: 'revisionComplete' });
    }
}
