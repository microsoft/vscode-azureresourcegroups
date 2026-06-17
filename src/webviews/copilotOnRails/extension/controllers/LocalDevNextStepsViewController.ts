/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ensureCopilotChatReady } from "../../../../commands/copilotOnRails/openChatWithAgent";
import { ext } from "../../../../extensionVariables";
import { type LocalDevNextStepsViewConfiguration } from "../../views/utils/viewConfigTypes";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";

type NextStepAction = 'iterate' | 'apiTests' | 'deploy';

export class LocalDevNextStepsViewController extends WebviewController<LocalDevNextStepsViewConfiguration> {
    constructor(initialConfig: LocalDevNextStepsViewConfiguration) {
        super(
            ext.context,
            vscode.l10n.t("Next steps"),
            'localDevNextStepsView',
            initialConfig,
            ViewColumn.Active,
            undefined,
            getCopilotOnRailsBundleLocation(),
        );

        this.panel.webview.onDidReceiveMessage((message: { command: string; action?: NextStepAction }) => {
            if (message.command !== 'nextStepSelected' || !message.action) {
                return;
            }
            void this.handleAction(message.action);
        });
    }

    private async handleAction(action: NextStepAction): Promise<void> {
        switch (action) {
            case 'iterate':
                if (!(await ensureCopilotChatReady())) {
                    return;
                }
                this.panel.dispose();
                await vscode.commands.executeCommand('workbench.view.debug');
                await vscode.commands.executeCommand('workbench.action.chat.open', {
                    query: vscode.l10n.t('I want to keep iterating on my project'),
                });
                return;
            case 'apiTests':
                if (!(await ensureCopilotChatReady())) {
                    return;
                }
                this.panel.dispose();
                await vscode.commands.executeCommand('workbench.action.chat.open', {
                    mode: 'azure-debug-generate',
                    query: vscode.l10n.t('Run the API tests to verify my endpoints.'),
                });
                return;
            case 'deploy':
                this.panel.dispose();
                await vscode.commands.executeCommand(
                    'azureResourceGroups.startDeployment',
                    vscode.l10n.t('The local development environment is set up and verified. Now prepare the project for deployment to Azure.'),
                );
                return;
        }
    }

    /** Push a new config (e.g. updated `hasApiTests`) into the running webview. */
    updateConfig(config: LocalDevNextStepsViewConfiguration): void {
        void this.panel.webview.postMessage({ command: 'updateNextStepsState', data: config });
    }
}
