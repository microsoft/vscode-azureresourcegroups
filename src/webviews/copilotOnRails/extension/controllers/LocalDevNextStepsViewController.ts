/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from "@microsoft/vscode-azext-utils";
import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { buildChatOpenOptions, ensureCopilotChatReady } from "../../../../commands/copilotOnRails/openChatWithAgent";
import { copilotOnRailsCommandIds } from "../../../../commands/copilotOnRails/registerCopilotOnRailsCommands";
import { azureDebugGenerateAgent } from "../../../../constants";
import { ext } from "../../../../extensionVariables";
import { callWithDiagnosticsAndTelemetryHandling, corId, setCorProp } from "../../../../utils/copilotOnRails/telemetryUtils";
import { type LocalDevNextStepsViewConfiguration } from "../../views/utils/viewConfigTypes";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";
import { openLoadingView } from "../openLoadingView";

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
        await callWithTelemetryAndErrorHandling(corId('debugNextStepsAction'), async (actionContext: IActionContext) => {
            actionContext.errorHandling.suppressDisplay = true;
            return await callWithDiagnosticsAndTelemetryHandling(actionContext, { type: 'webviewAction', name: 'debugNextStepsAction' }, async (corContext) => {
                setCorProp(corContext, 'action', action);

                switch (action) {
                    case 'iterate':
                        if (!(await ensureCopilotChatReady(corContext))) {
                            return;
                        }
                        this.panel.dispose();
                        await vscode.commands.executeCommand('workbench.view.debug');
                        await vscode.commands.executeCommand('workbench.action.chat.open', await buildChatOpenOptions(corContext, {
                            query: vscode.l10n.t('I want to keep iterating on my project'),
                        }));
                        return;
                    case 'apiTests':
                        if (!(await ensureCopilotChatReady(corContext))) {
                            return;
                        }
                        this.panel.dispose();
                        await vscode.commands.executeCommand('workbench.action.chat.open', await buildChatOpenOptions(corContext, {
                            mode: azureDebugGenerateAgent,
                            query: vscode.l10n.t('Run the API tests to verify my endpoints.'),
                        }));
                        openLoadingView({
                            stage: 1,
                            title: vscode.l10n.t('Running your API tests…'),
                            message: vscode.l10n.t('Copilot is executing the generated API test collection. For progress please view the Copilot chat.'),
                        });
                        return;
                    case 'deploy':
                        this.panel.dispose();
                        await vscode.commands.executeCommand(
                            copilotOnRailsCommandIds.startDeployment,
                            vscode.l10n.t('The local development environment is set up and verified. Now prepare the project for deployment to Azure.'),
                        );
                        return;
                }
            });
        });
    }

    /** Push a new config (e.g. updated `hasApiTests`) into the running webview. */
    updateConfig(config: LocalDevNextStepsViewConfiguration): void {
        void this.panel.webview.postMessage({ command: 'updateNextStepsState', data: config });
    }
}
