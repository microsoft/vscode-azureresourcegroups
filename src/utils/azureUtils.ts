/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupFromId } from '@microsoft/vscode-azext-azureutils';
import { nonNullProp } from '@microsoft/vscode-azext-utils';
import { AppResource, GroupNodeConfiguration, GroupingConfig } from '@microsoft/vscode-azext-utils/hostapi';
import { ThemeIcon, Uri } from 'vscode';
import { URI, Utils } from 'vscode-uri';
import { AzExtResourceType } from '../../api/src/index';
import { IAzExtMetadata, legacyTypeMap } from '../azureExtensions';
import { localize } from './localize';
import { treeUtils } from './treeUtils';

export function createGroupConfigFromResource(resource: AppResource, subscriptionId: string | undefined): GroupingConfig {
    const id = nonNullProp(resource, 'id');
    const unknown = localize('unknown', 'Unknown');
    let iconPath = getIconPath(resource.azExtResourceType);
    if (resource.azExtResourceType === AzExtResourceType.ContainerAppsEnvironment) {
        // Even though the child is a ContainerAppsEnvironment we want to show the Container Apps icon
        iconPath = getIconPath(AzExtResourceType.ContainerApps);
    }

    const groupConfig: GroupingConfig = {
        resourceGroup: {
            label: getResourceGroupFromId(id),
            id: id.substring(0, id.indexOf('/providers')).toLowerCase().replace('/resourcegroups', '/resourceGroups'),
            contextValuesToAdd: ['azureResourceGroup']
        },
        resourceType: {
            label: resource.azExtResourceType ? azExtDisplayInfo[resource.azExtResourceType ?? '']?.displayName ?? resource.azExtResourceType : unknown,
            id: `${subscriptionId}/${resource.azExtResourceType}`,
            iconPath,
            contextValuesToAdd: ['azureResourceTypeGroup', ...(resource.azExtResourceType ? [resource.azExtResourceType, legacyTypeMap[resource.azExtResourceType] ?? ''] : [])]
        },
        location: {
            id: `${subscriptionId}/location/${resource.location}` ?? 'unknown',
            label: resource.location ?? unknown,
            icon: new ThemeIcon('globe'),
            contextValuesToAdd: ['azureLocationGroup']
        }
    }

    if (resource.tags) {
        for (const tag of Object.keys(resource.tags)) {
            groupConfig[`armTag-${tag}`] = {
                label: resource.tags[tag],
                id: `${subscriptionId}/${tag}/${resource.tags[tag]}`,
                icon: new ThemeIcon('tag')
            }
        }
    }

    return groupConfig;
}

export function createAzureExtensionsGroupConfig(extensions: IAzExtMetadata[], subscriptionId: string): GroupNodeConfiguration[] {
    const azExtGroupConfigs: GroupNodeConfiguration[] = [];
    for (const azExt of extensions) {
        for (const azExtResourceType of azExt.resourceTypes) {
            azExtGroupConfigs.push({
                label: azExtDisplayInfo[azExtResourceType]?.displayName ?? azExtResourceType,
                id: `${subscriptionId}/${azExtResourceType}`.toLowerCase(),
                iconPath: getIconPath(azExtResourceType),
                contextValuesToAdd: ['azureResourceTypeGroup', azExtResourceType, legacyTypeMap[azExtResourceType] ?? '']
            });
        }
    }
    return azExtGroupConfigs;
}

export function getIconPath(azExtResourceType?: AzExtResourceType): Uri {
    return treeUtils.getIconPath(azExtResourceType ?
        Utils.joinPath(URI.file('azureIcons'), azExtResourceType).path :
        URI.file('resource').path);
}

export function getName(azExtResourceType?: AzExtResourceType): string | undefined {
    return azExtResourceType ? azExtDisplayInfo[azExtResourceType]?.displayName : undefined;
}

interface AzExtResourceTypeDisplayInfo {
    displayName: string;
}

const azExtDisplayInfo: Partial<Record<AzExtResourceType, AzExtResourceTypeDisplayInfo>> = {
    ApplicationInsights: { displayName: localize('insightsComponents', 'Application Insights') },
    AppServiceKubernetesEnvironment: { displayName: localize('containerService', 'App Service Kubernetes Environment') },
    AppServicePlans: { displayName: localize('serverFarms', 'App Service plans') },
    AppServices: { displayName: localize('webApp', 'App Services') },
    ArcEnabledMachines: { displayName: localize('arcEnabledMachines', 'Azure Arc-enabled machines') },
    AvailabilitySets: { displayName: localize('availabilitySets', 'Availability sets') },
    AzureCosmosDb: { displayName: localize('documentDB', 'Azure Cosmos DB') },
    BatchAccounts: { displayName: localize('batchAccounts', 'Batch accounts') },
    ContainerAppsEnvironment: { displayName: localize('containerAppsEnv', 'Container Apps') },
    ContainerRegistry: { displayName: localize('containerRegistry', 'Container registry') },
    Disks: { displayName: localize('disks', 'Disks') },
    FrontDoorAndCdnProfiles: { displayName: localize('frontDoorAndcdnProfiles', 'Front Door and CDN profiles') },
    FunctionApp: { displayName: localize('functionApp', 'Function App') },
    Images: { displayName: localize('images', 'Images') },
    LoadBalancers: { displayName: localize('loadBalancers', 'Load balancers') },
    LogicApp: { displayName: localize('logicApp', 'Logic App') },
    MongoClusters: { displayName: localize('mongoclusters', 'Azure Cosmos DB for MongoDB vCore') },
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
}
