/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from "@microsoft/vscode-azext-utils";
import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ext } from "../../../../extensionVariables";
import { copilotOnRailsCommandIds } from "../../../../commands/copilotOnRails/registerCopilotOnRailsCommands";
import { callWithDiagnosticsAndTelemetryHandling, CopilotOnRailsPhase, corId, setCorProp } from "../../../../utils/copilotOnRails/telemetryUtils";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";

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
        await callWithTelemetryAndErrorHandling(corId('nextStepsAction', CopilotOnRailsPhase.Scaffold), async (actionContext: IActionContext) => {
            actionContext.errorHandling.suppressDisplay = true;
            return await callWithDiagnosticsAndTelemetryHandling(actionContext, { type: 'webviewAction', name: 'scaffoldNextStepsAction' }, async (corContext) => {
                setCorProp(corContext, 'action', action);

                switch (action) {
                    case 'setupLocal':
                        this.panel.dispose();
                        await vscode.commands.executeCommand(
                            copilotOnRailsCommandIds.startLocalDevelopment,
                            vscode.l10n.t('The project has been scaffolded. Now set up the local debugging environment so I can start building and testing.'),
                        );
                        return;
                    case 'deploy':
                        this.panel.dispose();
                        await vscode.commands.executeCommand(
                            copilotOnRailsCommandIds.startDeployment,
                            vscode.l10n.t('The project has been scaffolded. Now prepare it for deployment to Azure.'),
                        );
                        return;
                }
            });
        });
    }

    /** Push a new config into the running webview. */
    updateConfig(config: Record<string, never>): void {
        void this.panel.webview.postMessage({ command: 'updateScaffoldNextStepsState', data: config });
    }
}
