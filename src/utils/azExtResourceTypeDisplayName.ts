/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtResourceType } from '../../api/src/index';
import { localize } from './localize';

/**
 * The extension's single source of localized display names for Azure resource types.
 *
 * Kept in its own module, free of VS Code and Azure SDK imports, so every surface that needs to
 * name a resource type can share it rather than growing a parallel English-only table.
 */

export function getName(azExtResourceType?: AzExtResourceType): string | undefined {
    return azExtResourceType ? azExtDisplayInfo[azExtResourceType]?.displayName : undefined;
}

interface AzExtResourceTypeDisplayInfo {
    displayName: string;
}

const azExtDisplayInfo: Partial<Record<AzExtResourceType, AzExtResourceTypeDisplayInfo>> = {
    AiFoundry: { displayName: localize('aiFoundry', 'Microsoft Foundry') },
    ApplicationInsights: { displayName: localize('insightsComponents', 'Application Insights') },
    AppServiceKubernetesEnvironment: { displayName: localize('containerService', 'App Service Kubernetes Environment') },
    AppServicePlans: { displayName: localize('serverFarms', 'App Service plans') },
    AppServices: { displayName: localize('webApp', 'App Services') },
    ArcEnabledMachines: { displayName: localize('arcEnabledMachines', 'Azure Arc-enabled machines') },
    AvailabilitySets: { displayName: localize('availabilitySets', 'Availability sets') },
    AzureCosmosDb: { displayName: localize('azureCosmosDb', 'Azure Cosmos DB') },
    AzureCosmosDbForMongoDbRu: { displayName: localize('azureCosmosDbForMongoDbRu', 'Azure Cosmos DB for MongoDB (RU)') },
    AzureDocumentDb: { displayName: localize('azureDocumentDB', 'Azure DocumentDB') },
    BatchAccounts: { displayName: localize('batchAccounts', 'Batch accounts') },
    ContainerAppsEnvironment: { displayName: localize('containerAppsEnv', 'Container Apps') },
    ContainerRegistry: { displayName: localize('containerRegistry', 'Container registry') },
    Disks: { displayName: localize('disks', 'Disks') },
    DurableTaskScheduler: { displayName: localize('durableTaskScheduler', 'Durable Task Scheduler') },
    FrontDoorAndCdnProfiles: { displayName: localize('frontDoorAndcdnProfiles', 'Front Door and CDN profiles') },
    FunctionApp: { displayName: localize('functionApp', 'Function App') },
    Images: { displayName: localize('images', 'Images') },
    LoadBalancers: { displayName: localize('loadBalancers', 'Load balancers') },
    LogicApp: { displayName: localize('logicApp', 'Logic App') },
    ManagedIdentityUserAssignedIdentities: { displayName: localize('managedIdentity', 'Managed Identities') },
    MongoClusters: { displayName: localize('mongoclusters', 'Azure DocumentDB') }, // TODO: remove in 2026: phased out with the introduction of https://github.com/microsoft/vscode-documentdb/pull/238
    MysqlServers: { displayName: localize('mysqlServers', 'MySql servers') },
    NetworkInterfaces: { displayName: localize('networkInterfaces', 'Network interfaces') },
    NetworkSecurityGroups: { displayName: localize('networkSecurityGroups', 'Network security groups') },
    NetworkWatchers: { displayName: localize('networkWatchers', 'Network watchers') },
    OperationalInsightsWorkspaces: { displayName: localize('operationalInsightsWorkspaces', 'Operational Insights workspaces') },
    OperationsManagementSolutions: { displayName: localize('operationsManagementSolutions', 'Operations management solutions') },
    PostgresqlServersFlexible: { displayName: localize('postgreSqlServers', 'PostgreSQL servers (Flexible)') },
    PostgresqlServersStandard: { displayName: localize('postgreSqlServers', 'PostgreSQL servers (Standard)') },
    PublicIpAddresses: { displayName: localize('publicIpAddresses', 'Public IP addresses') },
    SpringApps: { displayName: localize('springApps', 'Spring Apps') },
    SqlDatabases: { displayName: localize('sqlDatabases', 'SQL databases') },
    SqlServers: { displayName: localize('sqlServers', 'SQL servers') },
    StaticWebApps: { displayName: localize('staticWebApp', 'Static Web Apps') },
    StorageAccounts: { displayName: localize('storageAccounts', 'Storage accounts') },
    VirtualMachines: { displayName: localize('virtualMachines', 'Virtual machines') },
    VirtualMachineScaleSets: { displayName: localize('virtualMachineScaleSets', 'Virtual machine scale sets') },
    VirtualNetworks: { displayName: localize('virtualNetworks', 'Virtual networks') },
    WebPubSub: { displayName: localize('webPubSub', 'Web PubSub') }
};
