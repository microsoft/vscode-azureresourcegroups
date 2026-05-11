/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ext } from "../../../../extensionVariables";
import { type PlanData } from "../../views/utils/parseScaffoldPlanMarkdown";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";

export class ScaffoldPlanViewController extends WebviewController<Record<string, never>> {
    constructor(planData: PlanData) {
        super(ext.context, 'Project Plan', 'scaffoldPlanView', {}, ViewColumn.Active, undefined, getCopilotOnRailsBundleLocation());

        this.panel.webview.onDidReceiveMessage((message: { command: string; data?: PlanData; prompt?: string }) => {
            switch (message.command) {
                case 'ready':
                    void this.panel.webview.postMessage({ command: 'setPlanData', data: planData });
                    break;
                case 'approvePlan':
                    void vscode.commands.executeCommand('azureProjectCreation.completeStep', 'projectCreation/plan/definePlan');
                    void vscode.commands.executeCommand('workbench.action.chat.open', {
                        mode: 'azure-project-scaffold',
                        query: 'I approve the plan.',
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

    updatePlanData(planData: PlanData): void {
        void this.panel.webview.postMessage({ command: 'setPlanData', data: planData });
        void this.panel.webview.postMessage({ command: 'revisionComplete' });
    }
}
