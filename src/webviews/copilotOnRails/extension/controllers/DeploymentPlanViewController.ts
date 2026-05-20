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
    private latestPlanData: DeploymentPlanData;
    private sourceFileUri: vscode.Uri | undefined;

    constructor(planData: DeploymentPlanData, strings: DeploymentPlanViewStrings, sourceFileUri?: vscode.Uri) {
        super(ext.context, strings.title, 'deploymentPlanView', { strings }, ViewColumn.Active, undefined, getCopilotOnRailsBundleLocation());

        this.latestPlanData = planData;
        this.sourceFileUri = sourceFileUri;

        void this.postDeploymentPlanData();

        this.panel.webview.onDidReceiveMessage((message: { command: string; data?: unknown; prompt?: string }) => {
            switch (message.command) {
                case 'ready':
                    void this.postDeploymentPlanData();
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
                case 'openSourceFile':
                    this.openSourceFile();
                    break;
            }
        });
    }

    updateDeploymentPlanData(planData: DeploymentPlanData, sourceFileUri?: vscode.Uri): void {
        this.latestPlanData = planData;
        if (sourceFileUri) {
            this.sourceFileUri = sourceFileUri;
        }
        void this.postDeploymentPlanData();
        void this.panel.webview.postMessage({ command: 'revisionComplete' });
    }

    private async postDeploymentPlanData(): Promise<void> {
        await this.panel.webview.postMessage({ command: 'setDeploymentPlanData', data: this.latestPlanData });
    }

    private openSourceFile(): void {
        if (!this.sourceFileUri) {
            void vscode.window.showWarningMessage(
                vscode.l10n.t('The plan file location is unknown. Locate it manually in the workspace.'),
            );
            return;
        }
        void vscode.commands.executeCommand('vscode.open', this.sourceFileUri);
    }
}
