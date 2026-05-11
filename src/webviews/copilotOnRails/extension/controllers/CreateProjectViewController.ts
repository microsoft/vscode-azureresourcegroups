/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ensureCopilotChatReady } from "../../../../commands/copilotOnRails/openChatWithAgent";
import { ext } from "../../../../extensionVariables";
import { type CreateProjectViewControllerType } from "../../views/utils/viewConfigTypes";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";

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
        // Wait for GitHub Copilot Chat to be ready before disposing the panel and
        // executing the chat command. Otherwise, if Copilot Chat hasn't activated
        // yet, the chat command silently no-ops and the user is left with nothing.
        if (!(await ensureCopilotChatReady())) {
            return;
        }
        this.panel.dispose();
        await vscode.commands.executeCommand("workbench.action.chat.open", {
            mode: 'azure-project-scaffold',
            query,
        });
    }
}
