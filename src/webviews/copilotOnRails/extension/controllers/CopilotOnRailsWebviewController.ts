/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { escapeWebviewInitialData } from "../utils/escapeWebviewInitialData";

export class CopilotOnRailsWebviewController<Configuration> extends WebviewController<Configuration> {
    protected override getDocumentTemplate(webview?: vscode.Webview): string {
        return escapeWebviewInitialData(super.getDocumentTemplate(webview));
    }
}
