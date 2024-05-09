/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { signInToTenant } from '@microsoft/vscode-azext-azureauth';
import { AzExtTreeItem, IActionContext, isAzExtTreeItem, openUrl, registerCommand, registerErrorHandler, registerReportIssueCommand } from '@microsoft/vscode-azext-utils';
import { commands } from 'vscode';
import { uploadFileToCloudShell } from '../cloudConsole/uploadFileToCloudShell';
import { ext } from '../extensionVariables';
import { BranchDataItemWrapper } from '../tree/BranchDataItemWrapper';
import { ResourceGroupsItem } from '../tree/ResourceGroupsItem';
import { GroupingItem } from '../tree/azure/grouping/GroupingItem';
import { logIn } from './accounts/logIn';
import { selectSubscriptions } from './accounts/selectSubscriptions';
import { clearActivities } from './activities/clearActivities';
import { maintainCloudShellConnection } from './cloudShell';
import { createResource } from './createResource';
import { createResourceGroup } from './createResourceGroup';
import { deleteResourceGroupV2 } from './deleteResourceGroup/v2/deleteResourceGroupV2';
import { buildGroupByCommand } from './explorer/groupBy';
import { showGroupOptions } from './explorer/showGroupOptions';
import { focusGroup } from './focus/focusGroup';
import { unfocusGroup } from './focus/unfocusGroup';
import { getStarted } from './helpAndFeedback/getStarted';
import { reportIssue } from './helpAndFeedback/reportIssue';
import { reviewIssues } from './helpAndFeedback/reviewIssues';
import { installExtension } from './installExtension';
import { openInPortal } from './openInPortal';
import { revealResource } from './revealResource';
import { editTags } from './tags/editTags';
import { viewProperties } from './viewProperties';

export function registerCommands(): void {
    registerCommand('azureResourceGroups.uploadFileCloudConsole', uploadFileToCloudShell);

    registerCommand('azureResourceGroups.maintainCloudShellConnection', maintainCloudShellConnection);

    // Special-case refresh that ignores the selected/focused node and always refreshes the entire tree. Used by the refresh button in the tree title.
    registerCommand('azureResourceGroups.refreshTree', () => ext.actions.refreshAzureTree());
    registerCommand('azureWorkspace.refreshTree', () => ext.actions.refreshWorkspaceTree());
    registerCommand('azureFocusView.refreshTree', () => ext.actions.refreshFocusTree());

    // v1.5 client extensions attach these commands to tree item context menus for refreshing their tree items
    registerCommand('azureResourceGroups.refresh', async (context, node?: ResourceGroupsItem) => {
        await handleAzExtTreeItemRefresh(context, node); // for compatibility with v1.5 client extensions

        // override GroupingItem refresh and refresh subscription instead so that the resource list is refetched
        // see https://github.com/microsoft/vscode-azureresourcegroups/issues/617
        if (node instanceof GroupingItem) {
            ext.actions.refreshAzureTree(node.parent);
        } else {
            ext.actions.refreshAzureTree(node);
        }
    });
    registerCommand('azureWorkspace.refresh', async (context, node?: ResourceGroupsItem) => {
        await handleAzExtTreeItemRefresh(context, node); // for compatibility with v1.5 client extensions
        ext.actions.refreshWorkspaceTree(node);
    });

    registerCommand('azureFocusView.refresh', async (context, node?: ResourceGroupsItem) => {
        await handleAzExtTreeItemRefresh(context, node); // for compatibility with v1.5 client extensions
        ext.actions.refreshFocusTree(node);
    });

    registerCommand('azureResourceGroups.focusGroup', focusGroup);
    registerCommand('azureResourceGroups.unfocusGroup', unfocusGroup);

    registerCommand('azureResourceGroups.logIn', (context: IActionContext) => logIn(context));
    registerCommand('azureResourceGroups.selectSubscriptions', (context: IActionContext) => selectSubscriptions(context));
    registerCommand('azureResourceGroups.signInToTenant', async () => signInToTenant(await ext.subscriptionProviderFactory()));

    registerCommand('azureResourceGroups.createResourceGroup', createResourceGroup);
    registerCommand('azureResourceGroups.deleteResourceGroupV2', deleteResourceGroupV2);
    registerCommand('azureResourceGroups.loadMore', async (context: IActionContext, node: AzExtTreeItem) => await ext.appResourceTree.loadMore(node, context));
    registerCommand('azureResourceGroups.openInPortal', openInPortal);
    registerCommand('azureResourceGroups.revealResource', revealResource);
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

    registerCommand('azureResourceGroups.installExtension', installExtension);

    registerCommand('azureResourceGroups.clearActivities', clearActivities);
    registerCommand('azureResourceGroups.showGroupOptions', showGroupOptions);
    registerCommand('azureResourceGroups.openUrl', async (context: IActionContext, url: string) => {
        context.telemetry.properties.url = url;
        await openUrl(url)
    });

    registerCommand('azureWorkspace.loadMore', async (context: IActionContext, node: AzExtTreeItem) => await ext.workspaceTree.loadMore(node, context));
}

async function handleAzExtTreeItemRefresh(context: IActionContext, node?: ResourceGroupsItem): Promise<void> {
    if (node instanceof BranchDataItemWrapper) {
        const item = node.unwrap<AzExtTreeItem | unknown>();
        if (isAzExtTreeItem(item)) {
            await item.refresh(context);
        }
    }
}
