/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ensureCopilotChatReady } from "../../../../commands/copilotOnRails/openChatWithAgent";
import { azureDebugPlanAgent } from "../../../../constants";
import { ext } from "../../../../extensionVariables";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";
import { recordAgentLaunch } from "../projectSession";

type ScaffoldAction = 'setupLocal' | 'deploy';

export class ScaffoldNextStepsViewController extends WebviewController<Record<string, never>> {
    constructor(initialConfig: Record<string, never>) {
        super(
            ext.context,
            vscode.l10n.t("Next steps"),
            'scaffoldNextStepsView',
            initialConfig,
            ViewColumn.Active,
            undefined,
            getCopilotOnRailsBundleLocation(),
        );

        this.panel.webview.onDidReceiveMessage((message: { command: string; action?: ScaffoldAction }) => {
            if (message.command !== 'scaffoldNextStepSelected' || !message.action) {
                return;
            }
            void this.handleAction(message.action);
        });
    }

    private async handleAction(action: ScaffoldAction): Promise<void> {
        switch (action) {
            case 'setupLocal':
                this.panel.dispose();
               await vscode.commands.executeCommand(
                    'azureResourceGroups.startLocalDevelopment',
                    vscode.l10n.t('The project has been scaffolded. Now set up the local debugging environment so I can start building and testing.'),
                );
                await recordAgentLaunch(azureDebugPlanAgent);
                return;
            case 'deploy':
                this.panel.dispose();
                await vscode.commands.executeCommand(
                    'azureResourceGroups.startDeployment',
                    vscode.l10n.t('The project has been scaffolded. Now prepare it for deployment to Azure.'),
                );
                return;
        }
    }

    /** Push a new config into the running webview. */
    updateConfig(config: Record<string, never>): void {
        void this.panel.webview.postMessage({ command: 'updateScaffoldNextStepsState', data: config });
    }
}
