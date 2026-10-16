/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewController, type WebviewBundleLocation } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { userFeedbackFormUrl } from "../../shared/userFeedbackForm";
import { escapeWebviewInitialData } from "../utils/escapeWebviewInitialData";

const frameSourcePolicy = 'frame-src https://forms.cloud.microsoft https://forms.office.com http://localhost:* http://127.0.0.1:*;';

export function allowCopilotOnRailsFrames(template: string): string {
    return template.replace("form-action 'none';", `form-action 'none'; ${frameSourcePolicy}`);
}

export class CopilotOnRailsWebviewController<Configuration> extends WebviewController<Configuration> {
    constructor(
        context: vscode.ExtensionContext,
        title: string,
        webviewName: string,
        initialState: Configuration,
        viewColumn: vscode.ViewColumn = vscode.ViewColumn.One,
        iconPath?: vscode.Uri | { readonly light: vscode.Uri; readonly dark: vscode.Uri },
        bundleLocation?: WebviewBundleLocation,
    ) {
        super(context, title, webviewName, initialState, viewColumn, iconPath, bundleLocation);

        this.panel.webview.onDidReceiveMessage((message: unknown) => {
            if (!message || typeof message !== 'object' || !('command' in message)) {
                return;
            }

            const command = (message as { command?: unknown }).command;
            if (command === 'openUserFeedbackForm') {
                void vscode.env.openExternal(vscode.Uri.parse(userFeedbackFormUrl));
            }
        });
    }

    protected override getDocumentTemplate(webview?: vscode.Webview): string {
        return allowCopilotOnRailsFrames(escapeWebviewInitialData(super.getDocumentTemplate(webview)));
    }
}
