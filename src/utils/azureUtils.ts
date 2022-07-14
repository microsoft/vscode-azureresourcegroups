/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GenericResource, ResourceManagementClient } from '@azure/arm-resources';
import { uiUtils } from '@microsoft/vscode-azext-azureutils';
import { IActionContext, nonNullProp, TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azext-utils/azExtResourceType';
import { AppResource, GroupingConfig, GroupNodeConfiguration } from '@microsoft/vscode-azext-utils/hostapi';
import { ThemeIcon } from 'vscode';
import type { IAzExtMetadata } from '../azureExtensions';
import { ext } from '../extensionVariables';
import { createResourceClient } from './azureClients';
import { localize } from './localize';
import { treeUtils } from './treeUtils';

function parseResourceId(id: string): RegExpMatchArray {
    const matches: RegExpMatchArray | null = id.match(/\/subscriptions\/(.*)\/resourceGroups\/(.*)\/providers\/(.*)\/(.*)/i);

    if (matches === null || matches.length < 3) {
        throw new Error(localize('InvalidResourceId', 'Invalid Azure Resource Id'));
    }

    return matches;
}

export function getSubscriptionIdFromId(id: string): string {
    return parseResourceId(id)[1];
}

export function getResourceGroupFromId(id: string): string {
    return parseResourceId(id)[2];
}

export function createGroupConfigFromResource(resource: AppResource, subscriptionId: string | undefined): GroupingConfig {
    const id = nonNullProp(resource, 'id');
    const groupConfig: GroupingConfig = {
        resourceGroup: {
            label: getResourceGroupFromId(id),
            id: id.substring(0, id.indexOf('/providers')).toLowerCase().replace('/resourcegroups', '/resourceGroups'),
            contextValuesToAdd: ['azureResourceGroup']
        },
        resourceType: {
            label: azExtDisplayInfo[resource.azExtResourceType]?.displayName ?? resource.azExtResourceType,
            id: `${subscriptionId}/${resource.azExtResourceType}`,
            iconPath: getIconPath(resource.azExtResourceType),
            contextValuesToAdd: ['azureResourceTypeGroup', resource.azExtResourceType]
        },
        location: {
            id: `${subscriptionId}/location/${resource.location}` ?? 'unknown',
            label: resource.location ?? localize('unknown', 'Unknown'),
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
                id: `${subscriptionId}/${azExtResourceType}`,
                iconPath: getIconPath(azExtResourceType),
                contextValuesToAdd: ['azureResourceTypeGroup', azExtResourceType]
            });
        }
    }
    return azExtGroupConfigs;
}

export function getIconPath(azExtResourceType?: AzExtResourceType): TreeItemIconPath {
    return treeUtils.getIconPath(azExtResourceType ?? 'resources');
}

export async function getArmTagKeys(context: IActionContext): Promise<Set<string>> {
    const armTagKeys: Set<string> = new Set();
    for (const sub of (await ext.rootAccountTreeItem.getCachedChildren(context))) {
        const client: ResourceManagementClient = await createResourceClient([context, sub]);
        const tags = await uiUtils.listAllIterator(client.tagsOperations.list());
        for (const tag of tags) {
            tag.tagName ? armTagKeys.add(tag.tagName) : undefined;
        }
    }

    return armTagKeys;
}

// Execute `npm run listIcons` from root of repo to re-generate this list after adding an icon
export const supportedIconTypes = [
    'microsoft.web/functionapp',
    'microsoft.web/logicapp',
    'microsoft.web/hostingenvironments',
    'microsoft.web/kubeenvironments',
    'microsoft.web/serverfarms',
    'microsoft.web/sites',
    'microsoft.web/staticsites',
    'microsoft.storage/storageaccounts',
    'microsoft.sql/servers',
    'microsoft.sql/servers/databases',
    'microsoft.signalrservice/signalr',
    'microsoft.servicefabricmesh/applications',
    'microsoft.servicefabric/clusters',
    'microsoft.servicebus/namespaces',
    'microsoft.operationsmanagement/solutions',
    'microsoft.operationalinsights/workspaces',
    'microsoft.notificationhubs/namespaces',
    'microsoft.network/applicationgateways',
    'microsoft.network/applicationsecuritygroups',
    'microsoft.network/loadbalancers',
    'microsoft.network/localnetworkgateways',
    'microsoft.network/networkinterfaces',
    'microsoft.network/networksecuritygroups',
    'microsoft.network/networkwatchers',
    'microsoft.network/publicipaddresses',
    'microsoft.network/publicipprefixes',
    'microsoft.network/routetables',
    'microsoft.network/virtualnetworkgateways',
    'microsoft.network/virtualnetworks',
    'microsoft.managedidentity/userassignedidentities',
    'microsoft.logic/workflows',
    'microsoft.kubernetes/connectedclusters',
    'microsoft.keyvault/vaults',
    'microsoft.insights/components',
    'microsoft.extendedlocation/customlocations',
    'microsoft.eventhub/namespaces',
    'microsoft.eventgrid/domains',
    'microsoft.eventgrid/eventsubscriptions',
    'microsoft.eventgrid/topics',
    'microsoft.documentdb/databaseaccounts',
    'microsoft.devtestlab/labs',
    'microsoft.devices/iothubs',
    'microsoft.dbforpostgresql/servers',
    'microsoft.dbforpostgresql/flexibleservers',
    'microsoft.dbformysql/servers',
    'microsoft.containerservice/managedclusters',
    'microsoft.containerregistry/registries',
    'microsoft.compute/availabilitysets',
    'microsoft.compute/disks',
    'microsoft.compute/images',
    'microsoft.compute/virtualmachines',
    'microsoft.compute/virtualmachinescalesets',
    'microsoft.cdn/profiles',
    'microsoft.cache/redis',
    'microsoft.batch/batchaccounts',
    'microsoft.app/containerapps',
    'microsoft.app/managedenvironments',
    'microsoft.apimanagement/service',
] as const;

interface AzExtResourceTypeDisplayInfo {
    displayName: string;
}

const azExtDisplayInfo: Partial<Record<AzExtResourceType, AzExtResourceTypeDisplayInfo>> = {
    'AppServices': { displayName: localize('webApp', 'App Services') },
    'StaticWebApps': { displayName: localize('staticWebApp', 'Static Web Apps') },
    'FunctionApp': { displayName: localize('functionApp', 'Function App') },
    'LogicApp': { displayName: localize('logicApp', 'Logic App') },
    'VirtualMachines': { displayName: localize('virtualMachines', 'Virtual machines') },
    'StorageAccounts': { displayName: localize('storageAccounts', 'Storage accounts') },
    'NetworkSecurityGroups': { displayName: localize('networkSecurityGroups', 'Network security groups') },
    'LoadBalancers': { displayName: localize('loadBalancers', 'Load balancers') },
    'Disks': { displayName: localize('disks', 'Disks') },
    'Images': { displayName: localize('images', 'Images') },
    'AvailabilitySets': { displayName: localize('availabilitySets', 'Availability sets') },
    'VirtualMachineScaleSets': { displayName: localize('virtualMachineScaleSets', 'Virtual machine scale sets') },
    'VirtualNetworks': { displayName: localize('virtualNetworks', 'Virtual networks') },
    'FrontDoorAndCdnProfiles': { displayName: localize('frontDoorAndcdnProfiles', 'Front Door and CDN profiles') },
    'PublicIpAddresses': { displayName: localize('publicIpAddresses', 'Public IP addresses') },
    'NetworkInterfaces': { displayName: localize('networkInterfaces', 'Network interfaces') },
    'NetworkWatchers': { displayName: localize('networkWatchers', 'Network watchers') },
    'BatchAccounts': { displayName: localize('batchAccounts', 'Batch accounts') },
    'ContainerRegistry': { displayName: localize('containerRegistry', 'Container registry') },
    'PostgresqlServersStandard': { displayName: localize('postgreSqlServers', 'PostgreSQL servers (Standard)') },
    'PostgresqlServersFlexible': { displayName: localize('postgreSqlServers', 'PostgreSQL servers (Flexible)') },
    'MysqlServers': { displayName: localize('mysqlServers', 'MySql servers') },
    'SqlDatabases': { displayName: localize('sqlDatabases', 'SQL databases') },
    'SqlServers': { displayName: localize('sqlServers', 'SQL servers') },
    'AzureCosmosDb': { displayName: localize('documentDB', 'Azure Cosmos DB') },
    'OperationalInsightsWorkspaces': { displayName: localize('operationalInsightsWorkspaces', 'Operational Insights workspaces') },
    'OperationsManagementSolutions': { displayName: localize('operationsManagementSolutions', 'Operations management solutions') },
    'ApplicationInsights': { displayName: localize('insightsComponents', 'Application Insights') },
    'AppServicePlans': { displayName: localize('serverFarms', 'App Service plans') },
    'AppServiceKubernetesEnvironment': { displayName: localize('containerService', 'App Service Kubernetes Environment') },
    'ContainerAppsEnvironment': { displayName: localize('containerAppsEnv', 'Container Apps Environment') },
    'ContainerApps': { displayName: localize('containerApp', 'Container Apps') },
}

export function isFunctionApp(resource: GenericResource): boolean {
    const { type, kind } = resource;
    if (type?.toLowerCase() === 'microsoft.web/sites') {
        if (kind?.toLowerCase().includes('functionapp') && !kind?.toLowerCase().includes('workflowapp')) {
            return true;
        }
    }
    return false;
}

export function isLogicApp(resource: GenericResource): boolean {
    const { type, kind } = resource;
    if (type?.toLowerCase() === 'microsoft.web/sites') {
        if (kind?.toLowerCase().includes('functionapp') && kind?.toLowerCase().includes('workflowapp')) {
            return true;
        }
    }
    return false;
}

export function isAppServiceApp(resource: GenericResource): boolean {
    return resource.type?.toLowerCase() === 'microsoft.web/sites'
        && !isFunctionApp(resource)
        && !isLogicApp(resource);
}

function getRelevantKind(type?: string, kind?: string): string | undefined {
    if (isFunctionApp({ type, kind })) {
        return 'functionapp';
    }
    if (isLogicApp({ type, kind })) {
        return 'logicapp';
    }
    return undefined;
}

export function getResourceType(type?: string, kind?: string): string {
    const relevantKind = getRelevantKind(type, kind);
    const provider = type?.split('/')?.[0];
    return relevantKind ? `${provider}/${relevantKind}` : type?.toLowerCase() ?? '';
}
