/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ext } from "../../../../extensionVariables";
import { type LocalPlanData } from "../../views/utils/parseLocalPlanMarkdown";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";

export class LocalPlanViewController extends WebviewController<Record<string, never>> {
    constructor(planData: LocalPlanData) {
        super(ext.context, 'Local Dev Plan', 'localPlanView', {}, ViewColumn.Active, undefined, getCopilotOnRailsBundleLocation());

        this.panel.webview.onDidReceiveMessage((message: { command: string; data?: LocalPlanData; prompt?: string }) => {
            switch (message.command) {
                case 'ready':
                    void this.panel.webview.postMessage({ command: 'setLocalPlanData', data: planData });
                    break;
                case 'approvePlan':
                    void vscode.commands.executeCommand('azureProjectCreation.completeStep', 'projectCreation/localDevelopment/defineLocalPlan');
                    void vscode.commands.executeCommand('workbench.action.chat.open', {
                        mode: 'agent',
                        query: 'I approve the local dev plan.',
                    });
                    this.panel.dispose();
                    break;
                case 'submitPlanFeedback': {
                    const query = message.prompt?.trim();
                    if (!query) {
                        return;
                    }
                    void vscode.commands.executeCommand('workbench.action.chat.open', {
                        mode: 'agent',
                        query,
                    });
                    void this.panel.webview.postMessage({ command: 'revisionInProgress' });
                    break;
                }
            }
        });
    }

    updatePlanData(planData: LocalPlanData): void {
        void this.panel.webview.postMessage({ command: 'setLocalPlanData', data: planData });
        void this.panel.webview.postMessage({ command: 'revisionComplete' });
    }
}
