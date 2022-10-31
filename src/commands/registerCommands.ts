/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, IActionContext, openUrl, registerCommand, registerErrorHandler, registerReportIssueCommand } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { commands } from 'vscode';
import { ext } from '../extensionVariables';
import { clearActivities } from './activities/clearActivities';
import { createResource } from './createResource';
import { createResourceGroup } from './createResourceGroup';
import { deleteResourceGroup } from './deleteResourceGroup/deleteResourceGroup';
import { deleteResourceGroupV2 } from './deleteResourceGroup/v2/deleteResourceGroupV2';
import { focusGroup } from './explorer/focusGroup';
import { buildGroupByCommand } from './explorer/groupBy';
import { showGroupOptions } from './explorer/showGroupOptions';
import { unfocusGroup } from './explorer/unfocusGroup';
import { getStarted } from './helpAndFeedback/getStarted';
import { reportIssue } from './helpAndFeedback/reportIssue';
import { reviewIssues } from './helpAndFeedback/reviewIssues';
import { installExtension } from './installExtension';
import { openInPortal } from './openInPortal';
import { revealResource } from './revealResource';
import { editTags } from './tags/editTags';
import { toggleShowAllResources } from './toggleShowAllResources';
import { viewProperties } from './viewProperties';

export function registerCommands(
    refreshEventEmitter: vscode.EventEmitter<void>,
    onRefreshWorkspace: () => void): void {
    registerCommand('azureResourceGroups.createResourceGroup', createResourceGroup);
    registerCommand('azureResourceGroups.deleteResourceGroup', deleteResourceGroup);
    registerCommand('azureResourceGroups.deleteResourceGroupV2', deleteResourceGroupV2);
    registerCommand('azureResourceGroups.loadMore', async (context: IActionContext, node: AzExtTreeItem) => await ext.appResourceTree.loadMore(node, context));
    registerCommand('azureResourceGroups.openInPortal', openInPortal);
    registerCommand('azureResourceGroups.refresh', async (context: IActionContext, node?: AzExtTreeItem) => {
        await ext.appResourceTree.refresh(context, node); refreshEventEmitter.fire();
    });
    registerCommand('azureResourceGroups.revealResource', revealResource);
    registerCommand('azureResourceGroups.selectSubscriptions', () => commands.executeCommand('azure-account.selectSubscriptions'));
    registerCommand('azureResourceGroups.viewProperties', viewProperties);
    registerCommand('azureResourceGroups.editTags', editTags);

    registerCommand('ms-azuretools.getStarted', getStarted);
    registerCommand('ms-azuretools.loadMore', async (context: IActionContext, node: AzExtTreeItem) => await ext.helpTree.loadMore(node, context));
    registerCommand('ms-azuretools.reportIssue', reportIssue);
    registerCommand('ms-azuretools.reviewIssues', reviewIssues);
    registerCommand('ms-azuretools.openWalkthrough', () => commands.executeCommand('workbench.action.openWalkthrough', `ms-azuretools.vscode-azureresourcegroups#azure-get-started`));

    // Suppress "Report an Issue" button for all errors in favor of the command
    registerErrorHandler(c => c.errorHandling.suppressReportIssue = true);
    registerReportIssueCommand('azureResourceGroups.reportIssue');
    registerCommand('azureResourceGroups.createResource', createResource);

    registerCommand('azureResourceGroups.groupBy.resourceGroup', buildGroupByCommand('resourceGroup'));
    registerCommand('azureResourceGroups.groupBy.resourceType', buildGroupByCommand('resourceType'));
    registerCommand('azureResourceGroups.groupBy.location', buildGroupByCommand('location'));
    registerCommand('azureResourceGroups.groupBy.armTag', buildGroupByCommand('armTag'));

    registerCommand('azureResourceGroups.focusGroup', focusGroup);
    registerCommand('azureResourceGroups.unfocusGroup', unfocusGroup);

    registerCommand('azureResourceGroups.installExtension', installExtension);

    registerCommand('azureResourceGroups.clearActivities', clearActivities);
    registerCommand('azureResourceGroups.toggleShowAllResources', toggleShowAllResources);
    registerCommand('azureResourceGroups.showGroupOptions', showGroupOptions);
    registerCommand('azureResourceGroups.openUrl', async (context: IActionContext, url: string) => {
        context.telemetry.properties.url = url;
        await openUrl(url)
    });

    registerCommand('azureWorkspace.refresh', () => {
        onRefreshWorkspace();
        ext.emitters.refreshWorkspace.fire();
    });
    registerCommand('azureWorkspace.loadMore', async (context: IActionContext, node: AzExtTreeItem) => await ext.workspaceTree.loadMore(node, context));
}
