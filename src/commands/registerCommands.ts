/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { signInToTenant } from '@microsoft/vscode-azext-azureauth';
import { AzExtTreeItem, IActionContext, isAzExtTreeItem, nonNullValue, openUrl, registerCommand, registerCommandWithTreeNodeUnwrapping, registerErrorHandler, registerReportIssueCommand } from '@microsoft/vscode-azext-utils';
import { commands, l10n } from 'vscode';
import { askAgentAboutActivityLog } from '../chat/askAgentAboutActivityLog/askAgentAboutActivityLog';
import { askAgentAboutResource } from '../chat/askAgentAboutResource';
import { askAzureInCommandPalette } from '../chat/askAzure';
import { uploadFileToCloudShell } from '../cloudConsole/uploadFileToCloudShell';
import { ext } from '../extensionVariables';
import { TargetServiceRoleAssignmentItem } from '../managedIdentity/TargetServiceRoleAssignmentItem';
import { BranchDataItemWrapper } from '../tree/BranchDataItemWrapper';
import { ResourceGroupsItem } from '../tree/ResourceGroupsItem';
import { ActivityItem } from '../tree/activityLog/ActivityItem';
import { GroupingItem } from '../tree/azure/grouping/GroupingItem';
import { TenantTreeItem } from '../tree/tenants/TenantTreeItem';
import { createProjectWithCopilot } from '../webviews/copilotOnRails/extension/createProjectWithCopilot';
import { markProjectIntegrating, markProjectPlanIntegrated } from '../webviews/copilotOnRails/extension/flowState';
import { openDeploymentPlanViewFromWorkspace } from '../webviews/copilotOnRails/extension/openDeploymentPlanView';
import { openFrontendPreviewView } from '../webviews/copilotOnRails/extension/openFrontendPreviewView';
import { openLocalDevNextStepsView } from '../webviews/copilotOnRails/extension/openLocalDevNextStepsView';
import { openLocalPlanViewFromWorkspace } from '../webviews/copilotOnRails/extension/openLocalPlanView';
import { openRequirementsViewFromWorkspace } from '../webviews/copilotOnRails/extension/openRequirementsView';
import { openScaffoldNextStepsView } from '../webviews/copilotOnRails/extension/openScaffoldNextStepsView';
import { openPlanViewFromWorkspace } from '../webviews/copilotOnRails/extension/openScaffoldPlanView';
import { resumeProjectWithCopilot } from '../webviews/copilotOnRails/extension/resumeProjectWithCopilot';
import { logIn } from './accounts/logIn';
import { SelectSubscriptionOptions, selectSubscriptions } from './accounts/selectSubscriptions';
import { clearActivities } from './activities/clearActivities';
import { downloadAgentInstructions } from './copilotOnRails/agentInstructions';
import { openChatWithAgent } from './copilotOnRails/openChatWithAgent';
import { startDebugConfiguration } from './copilotOnRails/startDebugConfiguration';
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
import { configureSovereignCloud } from './sovereignCloud/configureSovereignCloud';
import { editTags } from './tags/editTags';
import { viewProperties } from './viewProperties';

export function registerCommands(): void {
    registerCommand('azureResourceGroups.uploadFileCloudConsole', uploadFileToCloudShell);

    // Special-case refresh that ignores the selected/focused node and always refreshes the entire tree. Used by the refresh button in the tree title.
    registerCommand('azureResourceGroups.refreshTree', () => {
        ext.setClearCacheOnNextLoad('azure');
        ext.actions.refreshAzureTree();
    });
    registerCommand('azureWorkspace.refreshTree', () => ext.actions.refreshWorkspaceTree());
    registerCommand('azureFocusView.refreshTree', () => {
        ext.setClearCacheOnNextLoad('focus');
        ext.actions.refreshFocusTree();
    });
    registerCommand('azureTenantsView.refreshTree', () => {
        ext.setClearCacheOnNextLoad('tenant');
        ext.actions.refreshTenantTree();
    });

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

    registerCommand('azureTenantsView.refresh', async (context, node?: ResourceGroupsItem) => {
        await handleAzExtTreeItemRefresh(context, node); // for compatibility with v1.5 client extensions
        ext.actions.refreshTenantTree(node);
    });

    registerCommand('azureActivityLogView.refresh', async (_context, node?: ResourceGroupsItem) => {
        ext.actions.refreshActivityLogTree(node);
    });

    registerCommand('azureTenantsView.signInToTenant', async (_context, node: TenantTreeItem) => {
        await (await ext.subscriptionProviderFactory()).signIn(node);
        ext.setClearCacheOnNextLoad('tenant');
        ext.actions.refreshTenantTree();
        ext.setClearCacheOnNextLoad('azure');
        ext.actions.refreshAzureTree();
        ext.setClearCacheOnNextLoad('focus');
        ext.actions.refreshFocusTree();
    });

    registerCommand('azureResourceGroups.focusGroup', focusGroup);
    registerCommand('azureResourceGroups.unfocusGroup', unfocusGroup);

    registerCommand('azureResourceGroups.logIn', (context: IActionContext) => logIn(context, { clearSessionPreference: true }));
    registerCommand('azureTenantsView.addAccount', (context: IActionContext) => logIn(context, { clearSessionPreference: true }));
    registerCommand('azureResourceGroups.selectSubscriptions', (context: IActionContext, options: SelectSubscriptionOptions) => selectSubscriptions(context, options));
    registerCommand('azureResourceGroups.signInToTenant', async () => {
        await signInToTenant(await ext.subscriptionProviderFactory());
        ext.setClearCacheOnNextLoad('tenant');
        ext.actions.refreshTenantTree();
        ext.setClearCacheOnNextLoad('azure');
        ext.actions.refreshAzureTree();
        ext.setClearCacheOnNextLoad('focus');
        ext.actions.refreshFocusTree();
    });

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
        await openUrl(url);
    });
    registerCommand('azureResourceGroups.askAzure', askAzureInCommandPalette);

    registerCommand('azureWorkspace.loadMore', async (context: IActionContext, node: AzExtTreeItem) => await ext.workspaceTree.loadMore(node, context));
    registerCommand('azureTenantsView.configureSovereignCloud', configureSovereignCloud);
    registerCommandWithTreeNodeUnwrapping('azureResourceGroups.loadAllSubscriptionRoleAssignments', async (_context: IActionContext, node?: TargetServiceRoleAssignmentItem) => {
        node = nonNullValue(node);
        node.setAllSubscriptionsLoaded();
        ext.azureTreeState.notifyChildrenChanged(node.id);
    });
    registerCommand("azureResourceGroups.askAgentAboutActivityLog", async (context: IActionContext, _node: ActivityItem) => await askAgentAboutActivityLog(context));
    registerCommandWithTreeNodeUnwrapping("azureResourceGroups.askAgentAboutActivityLogItem", askAgentAboutActivityLog);
    registerCommandWithTreeNodeUnwrapping<{ id?: string }>("azureResourceGroups.askAgentAboutResource", (context, node) => askAgentAboutResource(context, node));

    registerCommand('azureResourceGroups.createProjectWithCopilot', createProjectWithCopilot);
    registerCommand('azureResourceGroups.resumeProjectWithCopilot', resumeProjectWithCopilot);
    registerCommand('azureResourceGroups.openPlanView', openPlanViewFromWorkspace);
    registerCommand('azureResourceGroups.openLocalPlanView', openLocalPlanViewFromWorkspace);
    registerCommand('azureResourceGroups.openDeployPlanView', openDeploymentPlanViewFromWorkspace);
    registerCommand('azureResourceGroups.openRequirementsView', openRequirementsViewFromWorkspace);
    registerCommand('azureResourceGroups.openFrontendPreviewView', (_context: IActionContext, frontendFolder?: string) =>
        openFrontendPreviewView(frontendFolder));
    registerCommand('azureResourceGroups.openLocalNextStepsView', (_context: IActionContext, hasApiTests?: boolean) =>
        openLocalDevNextStepsView(hasApiTests));
    registerCommand('azureResourceGroups.debug.openLocalNextStepsView', () => openLocalDevNextStepsView());
    registerCommand('azureResourceGroups.openScaffoldNextStepsView', () => openScaffoldNextStepsView({}));

    // Hand-off commands
    registerCommand('azureResourceGroups.downloadAgentInstructions', (context: IActionContext) =>
        downloadAgentInstructions(context));
    registerCommand('azureResourceGroups.startProjectScaffold', (_context: IActionContext, prompt?: string) =>
        openChatWithAgent('azure-project-scaffold', prompt ?? 'Plan and scaffold a new Azure project: gather requirements, produce `.azure/project-plan.md`, require explicit user approval, then scaffold the frontend preview, backend services, database, and API routes.', {
            stage: 0,
            title: l10n.t('Scaffolding your project…'),
            message: l10n.t('Copilot is gathering requirements and preparing your project plan.'),
        }));
    registerCommand('azureResourceGroups.startProjectIntegrate', (_context: IActionContext, prompt?: string) =>
        markProjectIntegrating().then(() => openChatWithAgent('azure-project-integrate', prompt ?? 'The project has been scaffolded. Read `.azure/integration-plan.md`, then integrate the project: create the SQL/PostgreSQL schema migrations (no seed data), smoke-test the backend so every endpoint responds, wire the frontend to live data (remove all mock data), and run the frontend and backend together end-to-end.')));
    registerCommand('azureResourceGroups.startLocalDevelopment', (_context: IActionContext, prompt?: string) =>
        markProjectPlanIntegrated().then(() => openChatWithAgent('azure-debug-plan', prompt ?? 'The project has been scaffolded. Now set up the local debugging environment so the user can start building and testing.', {
            stage: 1,
            title: l10n.t('Setting up local development…'),
            message: l10n.t('Copilot is preparing your local debugging plan.'),
        })));
    registerCommand('azureResourceGroups.startDebugConfiguration', startDebugConfiguration);
    registerCommand('azureResourceGroups.startAzureDebugGenerate', (_context: IActionContext, prompt?: string) =>
        openChatWithAgent('azure-debug-generate', prompt ?? 'The local debugging plan has been approved. Now generate the artifacts as specified by `.azure/vscode-debug-plan.md`.', {
            stage: 1,
            title: l10n.t('Generating local development artifacts…'),
            message: l10n.t('Copilot is generating the artifacts from your local debugging plan.'),
        }));
    registerCommand('azureResourceGroups.startDeployment', (_context: IActionContext, prompt?: string) =>
        openChatWithAgent('azure-deploy', prompt ?? 'Prepare the project for deployment to Azure — generate `.azure/deployment-plan.md`, then the infrastructure (Bicep or Terraform), `azure.yaml`, and any Dockerfiles needed for `azd up`.', {
            stage: 2,
            title: l10n.t('Preparing deployment…'),
            message: l10n.t('Copilot is preparing your deployment plan.'),
        }));
}

async function handleAzExtTreeItemRefresh(context: IActionContext, node?: ResourceGroupsItem): Promise<void> {
    if (node instanceof BranchDataItemWrapper) {
        const item = node.unwrap<AzExtTreeItem | unknown>();
        if (isAzExtTreeItem(item)) {
            await item.refresh(context);
        }
    }
}
