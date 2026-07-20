/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, registerCommand } from '@microsoft/vscode-azext-utils';
import { l10n } from 'vscode';
import { azureDebugPlanAgent } from '../../constants';
import { ext } from '../../extensionVariables';
import { CopilotOnRailsContext } from '../../utils/copilotOnRails/CopilotOnRailsContext';
import { callWithDiagnosticsAndTelemetryHandling } from '../../utils/copilotOnRails/telemetryUtils';
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
import { startDebugConfiguration } from './startDebugConfiguration';

export const copilotOnRailsCommandIds = {
    // Phase 0...
    createProjectWithCopilot: 'azureResourceGroups.createProjectWithCopilot',
    resumeProjectWithCopilot: 'azureResourceGroups.resumeProjectWithCopilot',
    refreshProjectTree: 'azureProject.refresh',
    downloadAgentInstructions: 'azureResourceGroups.downloadAgentInstructions',

    // Phase 1...
    openRequirementsView: 'azureResourceGroups.openRequirementsView',
    openScaffoldPlanView: 'azureResourceGroups.openPlanView',
    startProjectScaffold: 'azureResourceGroups.startProjectScaffold',
    openFrontendPreviewView: 'azureResourceGroups.openFrontendPreviewView',
    startProjectIntegrate: 'azureResourceGroups.startProjectIntegrate',
    openScaffoldNextStepsView: 'azureResourceGroups.openScaffoldNextStepsView',

    // Phase 2...
    startLocalDevelopment: 'azureResourceGroups.startLocalDevelopment',
    openLocalPlanView: 'azureResourceGroups.openLocalPlanView',
    startAzureDebugGenerate: 'azureResourceGroups.startAzureDebugGenerate',
    openLocalNextStepsView: 'azureResourceGroups.openLocalNextStepsView',
    debugOpenLocalNextStepsView: 'azureResourceGroups.debug.openLocalNextStepsView',
    startDebugConfiguration: 'azureResourceGroups.startDebugConfiguration',

    // Phase 3...
    startDeployment: 'azureResourceGroups.startDeployment',
    openDeploymentPlanView: 'azureResourceGroups.openDeployPlanView',

    // Diagnostics...
    inspectDiagnostics: 'azureResourceGroups.inspectDiagnostics',
} as const;

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

export function startProjectScaffoldCommand(_context: CopilotOnRailsContext, prompt?: string): Promise<void> {
    return openChatWithAgent(copilotOnRailsCustomAgents.azureProjectScaffoldCustomAgent, prompt ?? 'Plan and scaffold a new Azure project: gather requirements, produce `.azure/project-plan.md`, require explicit user approval, then scaffold the frontend preview, backend services, database, and API routes.', {
        stage: 0,
        title: l10n.t('Scaffolding your project…'),
        message: l10n.t('Copilot is gathering requirements and preparing your project plan.'),
    });
}

export function startProjectIntegrateCommand(_context: CopilotOnRailsContext, prompt?: string): Promise<void> {
    return openChatWithAgent(copilotOnRailsCustomAgents.azureProjectIntegrateCustomAgent, prompt ?? 'The project has been scaffolded. Read `.azure/integration-plan.md`, then integrate the project: create the SQL/PostgreSQL schema migrations (no seed data), smoke-test the backend so every endpoint responds, wire the frontend to live data (remove all mock data), and run the frontend and backend together end-to-end.', {
        stage: 0,
        title: l10n.t('Integrating your frontend…'),
        message: l10n.t('Copilot is wiring the frontend to your backend services. For progress please view the Copilot chat.'),
    });
}

export function startLocalDevelopmentCommand(_context: CopilotOnRailsContext, prompt?: string): Promise<void> {
    return openChatWithAgent(azureDebugPlanAgent, prompt ?? 'The project has been scaffolded. Now set up the local debugging environment so the user can start building and testing.', {
        stage: 1,
        title: l10n.t('Setting up local development…'),
        message: l10n.t('Copilot is preparing your local debugging plan.'),
    });
}

export function startAzureDebugGenerateCommand(_context: CopilotOnRailsContext, prompt?: string): Promise<void> {
    return openChatWithAgent(copilotOnRailsCustomAgents.azureDebugGenerateCustomAgent, prompt ?? 'The local debugging plan has been approved. Now generate the artifacts as specified by `.azure/vscode-debug-plan.md`.', {
        stage: 1,
        title: l10n.t('Generating local development artifacts…'),
        message: l10n.t('Copilot is generating the artifacts from your local debugging plan.'),
    });
}

export function startDeploymentCommand(_context: CopilotOnRailsContext, prompt?: string): Promise<void> {
    return openChatWithAgent(copilotOnRailsCustomAgents.azureDeployCustomAgent, prompt ?? 'Prepare the project for deployment to Azure — generate `.azure/deployment-plan.md`, then the infrastructure (Bicep or Terraform), `azure.yaml`, and any Dockerfiles needed for `azd up`.', {
        stage: 2,
        title: l10n.t('Preparing deployment…'),
        message: l10n.t('Copilot is preparing your deployment plan.'),
    });
}

export function registerCopilotOnRailsCommands(): void {
    // Phase 0: Initialization commands
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.createProjectWithCopilot, createProjectWithCopilot);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.resumeProjectWithCopilot, resumeProjectWithCopilot);
    registerCommand(copilotOnRailsCommandIds.refreshProjectTree, () => ext.actions.refreshProjectTree());
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.downloadAgentInstructions, downloadAgentInstructions);

    // Phase 1: Project scaffolding commands
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.openRequirementsView, openRequirementsViewFromWorkspace);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.openScaffoldPlanView, openPlanViewFromWorkspace);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.startProjectScaffold, startProjectScaffoldCommand);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.openFrontendPreviewView, openFrontendPreviewView);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.startProjectIntegrate, startProjectIntegrateCommand);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.openScaffoldNextStepsView, openScaffoldNextStepsView);

    // Phase 2: Local debug / development commands
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.startLocalDevelopment, startLocalDevelopmentCommand);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.openLocalPlanView, openLocalPlanViewFromWorkspace);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.startAzureDebugGenerate, startAzureDebugGenerateCommand);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.openLocalNextStepsView, openLocalDevNextStepsView);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.debugOpenLocalNextStepsView, openLocalDevNextStepsView);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.startDebugConfiguration, startDebugConfiguration);

    // Phase 3: Deployment commands
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.startDeployment, startDeploymentCommand);
    registerCopilotOnRailsCommand(copilotOnRailsCommandIds.openDeploymentPlanView, openDeploymentPlanViewFromWorkspace);

    // Diagnostics
    registerCommand(copilotOnRailsCommandIds.inspectDiagnostics, inspectDiagnostics);
}
