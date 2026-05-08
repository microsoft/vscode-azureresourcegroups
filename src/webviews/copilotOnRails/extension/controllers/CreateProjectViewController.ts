/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
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
                        this.panel.dispose();
                        if (message.prompt) {
                            void this.openChatWithQuery(message.prompt);
                        }
                        break;
                }
            }
        );
    }

    private async openChatWithQuery(query: string): Promise<void> {
        await vscode.commands.executeCommand("workbench.action.chat.open", {
            mode: 'azure-project-scaffold',
            query,
        });
    }
}
