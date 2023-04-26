/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppResource } from "@microsoft/vscode-azext-utils/hostapi";
import { AzExtResourceType } from "../api/src/index";
import { localize } from "./utils/localize";

export const azureExtensions: IAzExtMetadata[] = [
    {
        name: 'vscode-azurefunctions',
        label: 'Functions',
        resourceTypes: [
            AzExtResourceType.FunctionApp
        ],
        tutorial: {
            label: localize('deployServerless', 'Create and deploy a serverless app'),
            url: 'https://aka.ms/AAb5xpj'
        },
        reportIssueCommandId: 'azureFunctions.reportIssue'
    },
    {
        name: 'vscode-azureappservice',
        label: 'App Service',
        resourceTypes: [
            AzExtResourceType.AppServices
        ],
        tutorial: {
            label: localize('deployWebApp', 'Deploy a web app'),
            url: 'https://aka.ms/AAb5dz2'
        },
        reportIssueCommandId: 'appService.ReportIssue'
    },
    {
        name: 'vscode-azurestaticwebapps',
        label: 'Static Web Apps',
        resourceTypes: [
            AzExtResourceType.StaticWebApps
        ],
        tutorial: {
            label: localize('deployStatic', 'Deploy a static app'),
            url: 'https://aka.ms/AAb5xp8'
        },
        reportIssueCommandId: 'staticWebApps.reportIssue'
    },
    {
        name: 'vscode-azureresourcegroups',
        label: 'Resource Groups',
        resourceTypes: [],
        reportIssueCommandId: 'azureResourceGroups.reportIssue'
    },
    {
        name: 'vscode-azurestorage',
        label: 'Storage',
        resourceTypes: [
            AzExtResourceType.StorageAccounts
        ],
        reportIssueCommandId: 'azureStorage.reportIssue'
    },
    {
        name: 'vscode-azurevirtualmachines',
        label: 'Virtual Machines',
        resourceTypes: [
            AzExtResourceType.VirtualMachines
        ],
        reportIssueCommandId: 'azureVirtualMachines.reportIssue'
    },
    {
        name: 'vscode-cosmosdb',
        label: 'Databases',
        resourceTypes: [
            AzExtResourceType.AzureCosmosDb,
            AzExtResourceType.PostgresqlServersStandard,
            AzExtResourceType.PostgresqlServersFlexible,
        ],
        reportIssueCommandId: 'azureDatabases.reportIssue'
    },
    {
        name: 'vscode-azurecontainerapps',
        label: 'Container Apps',
        resourceTypes: [
            AzExtResourceType.ContainerAppsEnvironment,
        ],
        reportIssueCommandId: 'containerApps.reportIssue'
    },
    {
        name: 'vscode-azurespringcloud',
        publisher: 'vscjava',
        label: 'Spring Apps',
        resourceTypes: [
            AzExtResourceType.SpringApps,
        ],
        reportIssueCommandId: 'springApps.reportIssue'
    },
    {
        name: 'vscode-azurelogicapps',
        publisher: "ms-azuretools",
        label: 'Logic Apps',
        resourceTypes: [
            AzExtResourceType.LogicApp,
        ],
        tutorial: {
            label: localize('createLogicApp', 'Create a standard logic app'),
            url: 'https://aka.ms/lalearn'
        },
        reportIssueCommandId: 'azureLogicAppsStandard.reportIssue'
    }
];

export const legacyTypeMap: Partial<Record<AzExtResourceType, string>> = {
    FunctionApp: 'microsoft.web/functionapp',
    AppServices: 'microsoft.web/sites',
    StaticWebApps: 'microsoft.web/staticsites',
    VirtualMachines: 'microsoft.compute/virtualmachines',
    AzureCosmosDb: 'microsoft.documentdb/databaseaccounts',
    PostgresqlServersStandard: 'microsoft.dbforpostgresql/servers',
    PostgresqlServersFlexible: 'microsoft.dbforpostgresql/flexibleservers',
    SpringApps: 'microsoft.appplatform/spring'
}

export interface IAzExtMetadata {
    name: string;
    label: string;
    publisher?: string;
    resourceTypes: AzExtResourceType[];
    tutorial?: IAzExtTutorial;
    reportIssueCommandId?: string;
}

export interface IAzExtResourceType {
    name: string;

    /**
     * Only necessary if the resourceType itself isn't enough to identify the extension
     */
    matchesResource(resource: AppResource): boolean;
}

export interface IAzExtTutorial {
    label: string;
    url: string;
}
