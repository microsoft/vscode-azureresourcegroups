/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { type IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from 'vscode';
import { CreateProjectViewController } from "./controllers/CreateProjectViewController";

export function createProjectWithCopilot(_context: IActionContext): void {
    const controller = new CreateProjectViewController({
        title: vscode.l10n.t('Create with Copilot'),
        heading: vscode.l10n.t('What would you like to build?'),
        subtitle: vscode.l10n.t('Describe your project and Copilot will help you build and deploy it to Azure Container Apps.'),
        promptPlaceholder: vscode.l10n.t('Describe your project...'),
        hint: vscode.l10n.t('Ctrl+Enter to build'),
        planButtonLabel: vscode.l10n.t('Plan'),
        buildButtonLabel: vscode.l10n.t('Build'),
    });
    controller.revealToForeground();
}
