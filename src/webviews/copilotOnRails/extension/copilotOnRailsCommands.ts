/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Command identifiers used by the Copilot-on-Rails project flow. Centralized so
 * the string literals don't drift between the tree provider, the webview
 * controllers, and `registerCommands`.
 */
export const copilotOnRailsCommandIds = {
    createProjectWithCopilot: 'azureResourceGroups.createProjectWithCopilot',
    resumeProjectWithCopilot: 'azureResourceGroups.resumeProjectWithCopilot',
    startProjectScaffold: 'azureResourceGroups.startProjectScaffold',
    startProjectIntegrate: 'azureResourceGroups.startProjectIntegrate',
    startLocalDevelopment: 'azureResourceGroups.startLocalDevelopment',
    startDeployment: 'azureResourceGroups.startDeployment',
    openScaffoldPlanView: 'azureResourceGroups.openPlanView',
    openLocalPlanView: 'azureResourceGroups.openLocalPlanView',
    openDeploymentPlanView: 'azureResourceGroups.openDeployPlanView',
    openRequirementsView: 'azureResourceGroups.openRequirementsView',
    openFrontendPreviewView: 'azureResourceGroups.openFrontendPreviewView',
    openLocalNextStepsView: 'azureResourceGroups.openLocalNextStepsView',
    openScaffoldNextStepsView: 'azureResourceGroups.openScaffoldNextStepsView',
} as const;
