/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, registerCommand } from '@microsoft/vscode-azext-utils';
import { l10n } from 'vscode';
import { createProjectWithCopilot } from '../../webviews/copilotOnRails/extension/createProjectWithCopilot';
import { openDeploymentPlanViewFromWorkspace } from '../../webviews/copilotOnRails/extension/openDeploymentPlanView';
import { openFrontendPreviewView } from '../../webviews/copilotOnRails/extension/openFrontendPreviewView';
import { openLocalDevNextStepsView } from '../../webviews/copilotOnRails/extension/openLocalDevNextStepsView';
import { openLocalPlanViewFromWorkspace } from '../../webviews/copilotOnRails/extension/openLocalPlanView';
import { openRequirementsViewFromWorkspace } from '../../webviews/copilotOnRails/extension/openRequirementsView';
import { openScaffoldNextStepsView } from '../../webviews/copilotOnRails/extension/openScaffoldNextStepsView';
import { openPlanViewFromWorkspace } from '../../webviews/copilotOnRails/extension/openScaffoldPlanView';
import { downloadAgentInstructions } from './agentInstructions';
import { openChatWithAgent } from './openChatWithAgent';
import { startDebugConfiguration } from './startDebugConfiguration';

// Phase 0...
const createProjectWithCopilotCommand = 'azureResourceGroups.createProjectWithCopilot';
const downloadAgentInstructionsCommand = 'azureResourceGroups.downloadAgentInstructions';

// Phase 1...
export const openRequirementsViewCommand = 'azureResourceGroups.openRequirementsView';
export const openPlanViewCommand = 'azureResourceGroups.openPlanView';
export const startProjectScaffoldCommand = 'azureResourceGroups.startProjectScaffold';
export const openFrontendPreviewViewCommand = 'azureResourceGroups.openFrontendPreviewView';
export const startProjectIntegrateCommand = 'azureResourceGroups.startProjectIntegrate';
export const openScaffoldNextStepsViewCommand = 'azureResourceGroups.openScaffoldNextStepsView';

// Phase 2...
export const startLocalDevelopmentCommand = 'azureResourceGroups.startLocalDevelopment';
export const openLocalPlanViewCommand = 'azureResourceGroups.openLocalPlanView';
export const startAzureDebugGenerateCommand = 'azureResourceGroups.startAzureDebugGenerate';
export const openLocalNextStepsViewCommand = 'azureResourceGroups.openLocalNextStepsView';
const debugOpenLocalNextStepsViewCommand = 'azureResourceGroups.debug.openLocalNextStepsView';
const startDebugConfigurationCommand = 'azureResourceGroups.startDebugConfiguration';

// Phase 3...
export const startDeploymentCommand = 'azureResourceGroups.startDeployment';
export const openDeployPlanViewCommand = 'azureResourceGroups.openDeployPlanView';

export function registerCopilotOnRailsCommands(): void {
    // Phase 0: Initialization commands
    registerCommand(createProjectWithCopilotCommand, createProjectWithCopilot);
    registerCommand(downloadAgentInstructionsCommand, downloadAgentInstructions);

    // Phase 1: Project scaffolding commands
    registerCommand(openRequirementsViewCommand, openRequirementsViewFromWorkspace);
    registerCommand(openPlanViewCommand, openPlanViewFromWorkspace);
    registerCommand(startProjectScaffoldCommand, (_context: IActionContext, prompt?: string) =>
        openChatWithAgent('azure-project-scaffold', prompt ?? 'Plan and scaffold a new Azure project: gather requirements, produce `.azure/project-plan.md`, require explicit user approval, then scaffold the frontend preview, backend services, database, and API routes.', {
            stage: 0,
            title: l10n.t('Scaffolding your project…'),
            message: l10n.t('Copilot is gathering requirements and preparing your project plan.'),
        }));
    registerCommand(openFrontendPreviewViewCommand, (_context: IActionContext, frontendFolder?: string) => openFrontendPreviewView(frontendFolder));
    registerCommand(startProjectIntegrateCommand, (_context: IActionContext, prompt?: string) =>
        openChatWithAgent('azure-project-integrate', prompt ?? 'The project has been scaffolded. Read `.azure/integration-plan.md`, then integrate the project: create the SQL/PostgreSQL schema migrations (no seed data), smoke-test the backend so every endpoint responds, wire the frontend to live data (remove all mock data), and run the frontend and backend together end-to-end.', {
            stage: 0,
            title: l10n.t('Integrating your frontend…'),
            message: l10n.t('Copilot is wiring the frontend to your backend services. For progress please view the Copilot chat.'),
        }));
    registerCommand(openScaffoldNextStepsViewCommand, () => openScaffoldNextStepsView({}));

    // Phase 2: Local debug / development commands
    registerCommand(startLocalDevelopmentCommand, (_context: IActionContext, prompt?: string) =>
        openChatWithAgent('azure-debug-plan', prompt ?? 'The project has been scaffolded. Now set up the local debugging environment so the user can start building and testing.', {
            stage: 1,
            title: l10n.t('Setting up local development…'),
            message: l10n.t('Copilot is preparing your local debugging plan.'),
        }));
    registerCommand(openLocalPlanViewCommand, openLocalPlanViewFromWorkspace);
    registerCommand(startAzureDebugGenerateCommand, (_context: IActionContext, prompt?: string) =>
        openChatWithAgent('azure-debug-generate', prompt ?? 'The local debugging plan has been approved. Now generate the artifacts as specified by `.azure/vscode-debug-plan.md`.', {
            stage: 1,
            title: l10n.t('Generating local development artifacts…'),
            message: l10n.t('Copilot is generating the artifacts from your local debugging plan.'),
        }));
    registerCommand(openLocalNextStepsViewCommand, (_context: IActionContext, hasApiTests?: boolean) => openLocalDevNextStepsView(hasApiTests));
    registerCommand(debugOpenLocalNextStepsViewCommand, () => openLocalDevNextStepsView());
    registerCommand(startDebugConfigurationCommand, startDebugConfiguration);

    // Phase 3: Deployment commands
    registerCommand(startDeploymentCommand, (_context: IActionContext, prompt?: string) =>
        openChatWithAgent('azure-deploy', prompt ?? 'Prepare the project for deployment to Azure — generate `.azure/deployment-plan.md`, then the infrastructure (Bicep or Terraform), `azure.yaml`, and any Dockerfiles needed for `azd up`.', {
            stage: 2,
            title: l10n.t('Preparing deployment…'),
            message: l10n.t('Copilot is preparing your deployment plan.'),
        }));
    registerCommand(openDeployPlanViewCommand, openDeploymentPlanViewFromWorkspace);
}
