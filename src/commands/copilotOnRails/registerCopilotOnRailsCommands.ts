/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, registerCommand } from '@microsoft/vscode-azext-utils';
import { l10n } from 'vscode';
import { azureDebugPlanAgent, azureProjectId } from '../../constants';
import { ext } from '../../extensionVariables';
import { CopilotOnRailsContext } from '../../utils/copilotOnRails/CopilotOnRailsContext';
import { callWithDiagnosticsAndTelemetryHandling, corId } from '../../utils/copilotOnRails/telemetryUtils';
import { createProjectWithCopilot } from '../../webviews/copilotOnRails/extension/createProjectWithCopilot';
import { openDeploymentPlanViewFromWorkspace } from '../../webviews/copilotOnRails/extension/openDeploymentPlanView';
import { openFrontendPreviewView } from '../../webviews/copilotOnRails/extension/openFrontendPreviewView';
import { openLocalDevNextStepsView } from '../../webviews/copilotOnRails/extension/openLocalDevNextStepsView';
import { openLocalPlanViewFromWorkspace } from '../../webviews/copilotOnRails/extension/openLocalPlanView';
import { openRequirementsViewFromWorkspace } from '../../webviews/copilotOnRails/extension/openRequirementsView';
import { openScaffoldNextStepsView } from '../../webviews/copilotOnRails/extension/openScaffoldNextStepsView';
import { openPlanViewFromWorkspace } from '../../webviews/copilotOnRails/extension/openScaffoldPlanView';
import { resumeProjectWithCopilot } from '../../webviews/copilotOnRails/extension/resumeProjectWithCopilot';
import { copilotOnRailsCustomAgents, downloadAgentInstructions } from './agentInstructions';
import { inspectDiagnostics } from './inspectDiagnostics';
import { openChatWithAgent } from './openChatWithAgent';
import { reportIssue } from './reportIssue';
import { startDebugConfiguration } from './startDebugConfiguration';

export const copilotOnRailsCommandIds = {
    createProjectWithCopilot: corId('createProjectWithCopilot'),
    downloadAgentInstructions: corId('downloadAgentInstructions'),
    openRequirementsView: corId('openRequirementsView'),
    openScaffoldPlanView: corId('openScaffoldPlanView'),
    startProjectScaffold: corId('startProjectScaffold'),
    openFrontendPreviewView: corId('openFrontendPreviewView'),
    startProjectIntegrate: corId('startProjectIntegrate'),
    openScaffoldNextStepsView: corId('openScaffoldNextStepsView'),

    startLocalDevelopment: corId('startLocalDevelopment'),
    openDebugPlanView: corId('openDebugPlanView'),
    startAzureDebugGenerate: corId('startAzureDebugGenerate'),
    openDebugNextStepsView: corId('openDebugNextStepsView'),
    startDebugConfiguration: corId('startDebugConfiguration'),

    startDeployment: corId('startDeployment'),
    openDeploymentPlanView: corId('openDeploymentPlanView'),

    resumeProjectWithCopilot: corId('resumeProjectWithCopilot'),
    refreshProjectTree: `${azureProjectId}.refresh`,
    inspectDiagnostics: corId('inspectDiagnostics'),
    reportIssue: corId('reportIssue'),
};

/**
 * Registers a Copilot on Rails extension command, wrapping it in the shared
 * {@link callWithDiagnosticsAndTelemetryHandling} so it runs with a prepared {@link CopilotOnRailsContext} and a
 * logged `extensionCommand` lifecycle.  Mirrors the same context shape an mcpTool hands the command.
 */
function registerCopilotOnRailsCommand<A extends unknown[]>(
    commandId: string,
    command: (context: CopilotOnRailsContext, ...args: A) => unknown,
): void {
    registerCommand(commandId, (context: IActionContext, ...args: A) =>
        callWithDiagnosticsAndTelemetryHandling(context, { type: 'extensionCommand', name: commandId }, async (corContext) => await command(corContext, ...args)),
    );
}

export function startProjectScaffoldCommand(context: CopilotOnRailsContext, prompt?: string): Promise<void> {
    return openChatWithAgent(context, copilotOnRailsCustomAgents.azureProjectScaffoldCustomAgent, prompt ?? 'Plan and scaffold a new Azure project: gather requirements, produce `.azure/project-plan.md`, require explicit user approval, then scaffold the frontend preview, backend services, database, and API routes.', {
        stage: 0,
        title: l10n.t('Scaffolding your project…'),
        message: l10n.t('Copilot is gathering requirements and preparing your project plan.'),
        showNeedHelp: true,
    });
}

export function startProjectIntegrateCommand(context: CopilotOnRailsContext, prompt?: string): Promise<void> {
    return openChatWithAgent(context, copilotOnRailsCustomAgents.azureProjectIntegrateCustomAgent, prompt ?? 'The project has been scaffolded. Read `.azure/integration-plan.md`, then integrate the project: create the SQL/PostgreSQL schema migrations (no seed data), smoke-test the backend so every endpoint responds, wire the frontend to live data (remove all mock data), and run the frontend and backend together end-to-end.', {
        stage: 0,
        title: l10n.t('Integrating your frontend…'),
        message: l10n.t('Copilot is wiring the frontend to your backend services. For progress please view the Copilot chat.'),
        showNeedHelp: true,
    });
}

export function startLocalDevelopmentCommand(context: CopilotOnRailsContext, prompt?: string): Promise<void> {
    return openChatWithAgent(context, azureDebugPlanAgent, prompt ?? 'The project has been scaffolded. Now set up the local debugging environment so the user can start building and testing.', {
        stage: 1,
        title: l10n.t('Setting up local development…'),
        message: l10n.t('Copilot is preparing your local debugging plan.'),
        showNeedHelp: true,
    });
}

export function startAzureDebugGenerateCommand(context: CopilotOnRailsContext, prompt?: string): Promise<void> {
    return openChatWithAgent(context, copilotOnRailsCustomAgents.azureDebugGenerateCustomAgent, prompt ?? 'The local debugging plan has been approved. Now generate the artifacts as specified by `.azure/vscode-debug-plan.md`.', {
        stage: 1,
        title: l10n.t('Generating local development artifacts…'),
        message: l10n.t('Copilot is generating the artifacts from your local debugging plan.'),
        showNeedHelp: true,
    });
}

export async function startDeploymentCommand(context: CopilotOnRailsContext, prompt?: string): Promise<void> {
    await openChatWithAgent(context, copilotOnRailsCustomAgents.azureDeployCustomAgent, prompt ?? 'Deploy the project to Azure. Generate `.azure/deployment-plan.md`, open its preview, and wait for user approval before preparing the required infrastructure and application artifacts. Then complete the mandatory azure-prepare → azure-validate → azure-deploy skill chain and verify the live endpoints.', {
        stage: 2,
        title: l10n.t('Deploying to Azure…'),
        message: l10n.t('Copilot is planning, validating, and deploying your project.'),
        showNeedHelp: true,
    });
}

export function registerCopilotOnRailsCommands(): void {
    // Phase 1: Project scaffolding commands
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.createProjectWithCopilot, createProjectWithCopilot);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.downloadAgentInstructions, downloadAgentInstructions);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.openRequirementsView, openRequirementsViewFromWorkspace);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.openScaffoldPlanView, openPlanViewFromWorkspace);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.startProjectScaffold, startProjectScaffoldCommand);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.openFrontendPreviewView, openFrontendPreviewView);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.startProjectIntegrate, startProjectIntegrateCommand);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.openScaffoldNextStepsView, openScaffoldNextStepsView);

    // Phase 2: Local debug / development commands
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.startLocalDevelopment, startLocalDevelopmentCommand);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.openDebugPlanView, openLocalPlanViewFromWorkspace);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.startAzureDebugGenerate, startAzureDebugGenerateCommand);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.openDebugNextStepsView, openLocalDevNextStepsView);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.startDebugConfiguration, startDebugConfiguration);

    // Phase 3: Deployment commands
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.startDeployment, startDeploymentCommand);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.openDeploymentPlanView, openDeploymentPlanViewFromWorkspace);

    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.resumeProjectWithCopilot, resumeProjectWithCopilot);
    registerCommand(copilotOnRailsCommandIds.refreshProjectTree, () => ext.actions.refreshProjectTree());
    registerCommand(copilotOnRailsCommandIds.inspectDiagnostics, inspectDiagnostics);
    registerCommand(copilotOnRailsCommandIds.reportIssue, reportIssue);
}
