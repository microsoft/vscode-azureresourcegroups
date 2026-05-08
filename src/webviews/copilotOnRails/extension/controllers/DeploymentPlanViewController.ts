/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ext } from "../../../../extensionVariables";
import { type DeploymentPlanData } from "../../views/utils/deploymentPlanTypes";
import { type DeploymentPlanViewConfiguration, type DeploymentPlanViewStrings } from "../../views/utils/viewConfigTypes";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";

export type { DeploymentPlanViewConfiguration, DeploymentPlanViewStrings };

export class DeploymentPlanViewController extends WebviewController<DeploymentPlanViewConfiguration> {
    constructor(planData: DeploymentPlanData, strings: DeploymentPlanViewStrings) {
        super(ext.context, strings.title, 'deploymentPlanView', { strings }, ViewColumn.Active, undefined, getCopilotOnRailsBundleLocation());

        this.panel.webview.onDidReceiveMessage((message: { command: string; data?: unknown; prompt?: string }) => {
            switch (message.command) {
                case 'ready':
                    void this.panel.webview.postMessage({ command: 'setDeploymentPlanData', data: planData });
                    break;
                case 'approve':
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

    updateDeploymentPlanData(planData: DeploymentPlanData): void {
        void this.panel.webview.postMessage({ command: 'setDeploymentPlanData', data: planData });
        void this.panel.webview.postMessage({ command: 'revisionComplete' });
    }
}
