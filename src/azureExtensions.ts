/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GenericResource } from "@azure/arm-resources";
import { localize } from "./utils/localize";

export const azureExtensions: IAzExtMetadata[] = [
    {
        name: 'vscode-azurefunctions',
        label: 'Functions',
        resourceTypes: [
            {
                name: 'microsoft.web/sites',
                matchesResource: isFunctionApp
            }
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
            {
                name: 'microsoft.web/sites',
                matchesResource: r => !isFunctionApp(r)
            }
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
            'microsoft.web/staticsites'
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
            'microsoft.storage/storageaccounts'
        ],
        reportIssueCommandId: 'azureStorage.reportIssue'
    },
    {
        name: 'vscode-azurevirtualmachines',
        label: 'Virtual Machines',
        resourceTypes: [
            'microsoft.compute/virtualmachines'
        ],
        reportIssueCommandId: 'azureVirtualMachines.reportIssue'
    },
    {
        name: 'vscode-azureeventgrid',
        label: 'Event Grid',
        resourceTypes: [
            'microsoft.eventgrid/eventsubscriptions',
            'microsoft.eventgrid/topics'
        ]
    },
    {
        name: 'vscode-cosmosdb',
        label: 'Databases',
        resourceTypes: [
            'microsoft.documentdb/databaseaccounts',
            'microsoft.dbforpostgresql/servers'
        ],
        reportIssueCommandId: 'azureDatabases.reportIssue'
    },
    {
        name: 'vscode-azurecontainerapps',
        label: 'Container Apps',
        resourceTypes: [
            'microsoft.app/containerapps'
        ],
        reportIssueCommandId: 'containerApps.reportIssue'
    }
];

export interface IAzExtMetadata {
    name: string;
    label: string;
    publisher?: string;
    resourceTypes: (string | IAzExtResourceType)[];
    tutorial?: IAzExtTutorial;
    reportIssueCommandId?: string;
}

export interface IAzExtResourceType {
    name: string;

    /**
     * Only necessary if the resourceType itself isn't enough to identify the extension
     */
    matchesResource(resource: GenericResource): boolean;
}

export interface IAzExtTutorial {
    label: string;
    url: string;
}

function isFunctionApp(resource: GenericResource): boolean {
    return !!resource.kind?.toLowerCase().includes('functionapp');
}
