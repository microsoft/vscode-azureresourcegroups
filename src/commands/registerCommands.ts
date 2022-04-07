/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, IActionContext, registerCommand, registerErrorHandler, registerReportIssueCommand } from '@microsoft/vscode-azext-utils';
import { commands } from 'vscode';
import { ext } from '../extensionVariables';
import { createResource } from './createResource';
import { createResourceGroup } from './createResourceGroup';
import { deleteResourceGroup } from './deleteResourceGroup';
import { buildGroupByCommand } from './explorer/groupBy';
import { getStarted } from './helpAndFeedback/getStarted';
import { reportIssue } from './helpAndFeedback/reportIssue';
import { reviewIssues } from './helpAndFeedback/reviewIssues';
import { openInPortal } from './openInPortal';
import { revealResource } from './revealResource';
import { editTags } from './tags/editTags';
import { viewProperties } from './viewProperties';
import { refreshWorkspace } from './workspace/refreshWorkspace';

export function registerCommands(): void {
    registerCommand('azureResourceGroups.createResourceGroup', createResourceGroup);
    registerCommand('azureResourceGroups.deleteResourceGroup', deleteResourceGroup);
    registerCommand('azureResourceGroups.loadMore', async (context: IActionContext, node: AzExtTreeItem) => await ext.tree.loadMore(node, context));
    registerCommand('azureResourceGroups.openInPortal', openInPortal);
    registerCommand('azureResourceGroups.refresh', async (context: IActionContext, node?: AzExtTreeItem) => await ext.tree.refresh(context, node));
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
    registerCommand('azureResourceGroups.createResource', createResource);
    registerCommand('azureResourceGroups.refreshWorkspace', refreshWorkspace);
    registerCommand('azureResourceGroups.groupBy.resourceGroup', buildGroupByCommand('resourceGroup'));
    registerCommand('azureResourceGroups.groupBy.resourceType', buildGroupByCommand('resourceType'));
    registerCommand('azureResourceGroups.groupBy.location', buildGroupByCommand('location'));
    registerCommand('azureResourceGroups.groupBy.armTag', buildGroupByCommand('armTag'));
}
