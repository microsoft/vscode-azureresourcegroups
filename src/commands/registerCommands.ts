/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands } from 'vscode';
import { AzExtTreeItem, AzureTreeItem, IActionContext, registerCommand, registerErrorHandler, registerReportIssueCommand } from 'vscode-azureextensionui';
import { ext } from '../extensionVariables';
import { createResourceGroup } from './createResourceGroup';
import { deleteResourceGroup } from './deleteResourceGroup';
import { getStarted } from './helpAndFeedback/getStarted';
import { reportIssue } from './helpAndFeedback/reportIssue';
import { reviewIssues } from './helpAndFeedback/reviewIssues';
import { openInPortal } from './openInPortal';
import { revealResource } from './revealResource';
import { editTags } from './tags/editTags';
import { viewProperties } from './viewProperties';

export function registerCommands(): void {
    registerCommand('azureResourceGroups.createResourceGroup', createResourceGroup);
    registerCommand('azureResourceGroups.deleteResourceGroup', deleteResourceGroup);
    registerCommand('azureResourceGroups.loadMore', async (context: IActionContext, node: AzureTreeItem) => await ext.tree.loadMore(node, context));
    registerCommand('azureResourceGroups.openInPortal', openInPortal);
    registerCommand('azureResourceGroups.refresh', async (context: IActionContext, node?: AzureTreeItem) => await ext.tree.refresh(context, node));
    registerCommand('azureResourceGroups.revealResource', revealResource);
    registerCommand('azureResourceGroups.selectSubscriptions', () => commands.executeCommand('azure-account.selectSubscriptions'));
    registerCommand('azureResourceGroups.viewProperties', viewProperties);
    registerCommand('azureResourceGroups.editTags', editTags);

    registerCommand('ms-azuretools.getStarted', getStarted);
    registerCommand('ms-azuretools.loadMore', async (context: IActionContext, node: AzExtTreeItem) => await ext.helpTree.loadMore(node, context));
    registerCommand('ms-azuretools.reportIssue', reportIssue);
    registerCommand('ms-azuretools.reviewIssues', reviewIssues);

    // Suppress "Report an Issue" button for all errors in favor of the command
    registerErrorHandler(c => c.errorHandling.suppressReportIssue = true);
    registerReportIssueCommand('azureResourceGroups.reportIssue');
}
