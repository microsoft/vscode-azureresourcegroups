/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ensureAgentInstructions } from "../../../../commands/copilotOnRails/agentInstructions";
import { ensureCopilotChatReady } from "../../../../commands/copilotOnRails/openChatWithAgent";
import { ext } from "../../../../extensionVariables";
import { projectSubmissionState } from "../../../../tree/project/projectSubmissionState";
import { type CreateProjectViewControllerType } from "../../views/utils/viewConfigTypes";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";
import { openLoadingView } from "../openLoadingView";

export type { CreateProjectViewControllerType };

export class CreateProjectViewController extends WebviewController<CreateProjectViewControllerType> {
    constructor(viewConfig: CreateProjectViewControllerType) {
        super(ext.context, viewConfig.title, 'createProjectView', viewConfig, ViewColumn.Active, undefined, getCopilotOnRailsBundleLocation());

        this.panel.webview.onDidReceiveMessage(
            (message: { command: string; prompt?: string }) => {
                switch (message.command) {
                    case 'plan':
                        if (message.prompt) {
                            void this.openChatWithQuery(message.prompt);
                        } else {
                            this.panel.dispose();
                        }
                        break;
                }
            }
        );
    }

    private async openChatWithQuery(query: string): Promise<void> {
        if (!(await ensureCopilotChatReady())) {
            return;
        }
        if (!(await ensureAgentInstructions('azure-project-plan'))) {
            return;
        }
        this.panel.dispose();
        await vscode.commands.executeCommand('workbench.action.chat.newChat');
        await vscode.commands.executeCommand("workbench.action.chat.open", {
            mode: 'azure-project-plan',
            query,
        });
        projectSubmissionState.setPending();
        openLoadingView({
            stage: 0,
            title: vscode.l10n.t('Gathering project requirements…'),
            message: vscode.l10n.t('Copilot is analyzing your prompt and preparing the requirements questionnaire.'),
        });
    }
}
