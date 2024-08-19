/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppResource } from "@microsoft/vscode-azext-utils/hostapi";
import { extensions } from "vscode";
import { AzExtResourceType } from "../api/src/index";
import { localize } from "./utils/localize";


/**
 * This is a temporary function usend to optionaly enable support for MongoClusters in the Azure Resources extension.
 *
 * This solution is necessary for a staged release of the MongoClusters feature from the vscode-cosmosdb extension.
 * It will be removed once the MongoClusters feature is fully released.
 *
 * @returns
 */
function enableMongoClustersSupport() {
    const vsCodeCosmosDBConfiguration = extensions.getExtension('ms-azuretools.vscode-cosmosdb')?.packageJSON as ExtensionPackageMongoClustersEnabled;
    return (vsCodeCosmosDBConfiguration && vsCodeCosmosDBConfiguration.enableMongoClusters);
}

/**
 * This is a temporary interface used to enable support for MongoClusters in the Azure Resources extension.
 * It will be removed once the MongoClusters feature is fully released.
 */
interface ExtensionPackageMongoClustersEnabled {
    readonly enableMongoClusters?: boolean;
}

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
        name: 'vscode-azurearcenabledmachines',
        label: 'Azure Arc-enabled machines',
        resourceTypes: [
            AzExtResourceType.ArcEnabledMachines
        ],
        reportIssueCommandId: 'azureArcEnabledMachines.ReportIssue'
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
        resourceTypes:
            /**
            * This is a temporary interface used to enable support for MongoClusters in the Azure Resources extension.
            * It will be removed once the MongoClusters feature is fully released.
            */
            enableMongoClustersSupport() ?
                [
                    AzExtResourceType.AzureCosmosDb,
                    AzExtResourceType.MongoClusters,
                    AzExtResourceType.PostgresqlServersStandard,
                    AzExtResourceType.PostgresqlServersFlexible,
                ] :
                [
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
    },
    {
        name: 'vscode-azurewebpubsub',
        label: 'Web PubSub',
        resourceTypes: [
            AzExtResourceType.WebPubSub
        ],
        reportIssueCommandId: 'azureWebPubSub.reportIssue'
    },
];

export const legacyTypeMap: Partial<Record<AzExtResourceType, string>> = {
    FunctionApp: 'microsoft.web/functionapp',
    AppServices: 'microsoft.web/sites',
    StaticWebApps: 'microsoft.web/staticsites',
    VirtualMachines: 'microsoft.compute/virtualmachines',
    AzureCosmosDb: 'microsoft.documentdb/databaseaccounts',
    MongoClusters: 'microsoft.documentdb/mongoclusters',
    PostgresqlServersStandard: 'microsoft.dbforpostgresql/servers',
    PostgresqlServersFlexible: 'microsoft.dbforpostgresql/flexibleservers',
    SpringApps: 'microsoft.appplatform/spring',
    WebPubSub: 'microsoft.signalrservice/webpubsub'
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
