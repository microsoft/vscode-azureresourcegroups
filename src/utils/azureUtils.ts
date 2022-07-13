/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GenericResource, ResourceManagementClient } from '@azure/arm-resources';
import { uiUtils } from '@microsoft/vscode-azext-azureutils';
import { IActionContext, nonNullProp, TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import { GroupingConfig, GroupNodeConfiguration } from '@microsoft/vscode-azext-utils/hostapi';
import { ThemeIcon } from 'vscode';
import type { IAzExtMetadata } from '../azureExtensions';
import { ext } from '../extensionVariables';
import { createResourceClient } from './azureClients';
import { localize } from './localize';
import { treeUtils } from './treeUtils';
import path = require('path');

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

export function createGroupConfigFromResource(resource: GenericResource, subscriptionId: string | undefined): GroupingConfig {
    const id = nonNullProp(resource, 'id');
    const groupConfig: GroupingConfig = {
        resourceGroup: {
            label: getResourceGroupFromId(id),
            id: id.substring(0, id.indexOf('/providers')).toLowerCase().replace('/resourcegroups', '/resourceGroups'),
            contextValuesToAdd: ['azureResourceGroup']
        },
        resourceType: {
            label: getName(resource.type, resource.kind) ?? resource.type ?? 'unknown',
            id: getId(subscriptionId, resource.type, resource.kind),
            iconPath: getIconPath(resource?.type ?? 'resource', resource.kind),
            contextValuesToAdd: ['azureResourceTypeGroup', getResourceType(resource.type, resource.kind)]
        },
        location: {
            id: `${subscriptionId}/location/${resource.location}` ?? 'unknown',
            label: resource.location ?? localize('unknown', 'Unknown'),
            icon: new ThemeIcon('globe'),
            contextValuesToAdd: ['azureLocationGroup']
        }
    }

    resource.tags ||= {};
    for (const tag of Object.keys(resource.tags)) {
        groupConfig[`armTag-${tag}`] = {
            label: resource.tags[tag],
            id: `${subscriptionId}/${tag}/${resource.tags[tag]}`,
            icon: new ThemeIcon('tag')
        }
    }

    return groupConfig;
}

export function createAzureExtensionsGroupConfig(extensions: IAzExtMetadata[], subscriptionId: string): GroupNodeConfiguration[] {
    const azExtGroupConfigs: GroupNodeConfiguration[] = [];
    for (const azExt of extensions) {
        for (const resourceType of azExt.resourceTypes) {
            const type = typeof resourceType === 'string' ? resourceType : resourceType.name;
            const kind = azExt.name === 'vscode-azurefunctions' ? 'functionapp' : undefined;

            azExtGroupConfigs.push({
                label: getName(type, kind) ?? type ?? 'unknown',
                id: getId(subscriptionId, type, kind),
                iconPath: getIconPath(type ?? 'resource', kind),
                contextValuesToAdd: ['azureResourceTypeGroup', getResourceType(type, kind)]
            });
        }
    }
    return azExtGroupConfigs;
}

function getId(subscriptionId?: string, type?: string, kind?: string): string {
    const rType: string = getResourceType(type, kind);
    return `${subscriptionId}/${rType}`;
}

export function getIconPath(type?: string, kind?: string): TreeItemIconPath {
    let iconName: string;
    const rType: string = getResourceType(type, kind).toLowerCase();
    if (supportedIconTypes.includes(rType as SupportedTypes)) {
        iconName = path.join('providers', rType);
    } else {
        iconName = 'resource';
    }

    return treeUtils.getIconPath(iconName);
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

type SupportedTypes = typeof supportedIconTypes[number];

interface SupportedType {
    displayName: string;
}

function getName(type?: string, kind?: string): string | undefined {
    const rType: string = getResourceType(type, kind).toLowerCase();
    return supportedTypes[rType as SupportedTypes]?.displayName;
}

// intersect with Record<stirng, SupportedType> so we can add info for resources we don't have icons for
type SupportedTypeMap = Partial<Record<SupportedTypes, SupportedType> & Record<string, SupportedType>>;

const supportedTypes: SupportedTypeMap = {
    'microsoft.web/sites': { displayName: localize('webApp', 'App Services') },
    'microsoft.web/staticsites': { displayName: localize('staticWebApp', 'Static Web Apps') },
    'microsoft.web/functionapp': { displayName: localize('functionApp', 'Function App') },
    'microsoft.web/logicapp': { displayName: localize('logicApp', 'Logic App') },
    'microsoft.compute/virtualmachines': { displayName: localize('virtualMachines', 'Virtual machines') },
    'microsoft.storage/storageaccounts': { displayName: localize('storageAccounts', 'Storage accounts') },
    'microsoft.network/networksecuritygroups': { displayName: localize('networkSecurityGroups', 'Network security groups') },
    'microsoft.network/loadbalancers': { displayName: localize('loadBalancers', 'Load balancers') },
    'microsoft.compute/disks': { displayName: localize('disks', 'Disks') },
    'microsoft.compute/images': { displayName: localize('images', 'Images') },
    'microsoft.compute/availabilitysets': { displayName: localize('availabilitySets', 'Availability sets') },
    'microsoft.compute/virtualmachinescalesets': { displayName: localize('virtualMachineScaleSets', 'Virtual machine scale sets') },
    'microsoft.network/virtualnetworks': { displayName: localize('virtualNetworks', 'Virtual networks') },
    'microsoft.cdn/profiles': { displayName: localize('frontDoorAndcdnProfiles', 'Front Door and CDN profiles') },
    'microsoft.network/publicipaddresses': { displayName: localize('publicIpAddresses', 'Public IP addresses') },
    'microsoft.network/networkinterfaces': { displayName: localize('networkInterfaces', 'Network interfaces') },
    'microsoft.network/networkwatchers': { displayName: localize('networkWatchers', 'Network watchers') },
    'microsoft.batch/batchaccounts': { displayName: localize('batchAccounts', 'Batch accounts') },
    'microsoft.containerregistry/registries': { displayName: localize('containerRegistry', 'Container registry') },
    'microsoft.dbforpostgresql/servers': { displayName: localize('postgreSqlServers', 'PostgreSQL servers (Standard)') },
    'microsoft.dbforpostgresql/flexibleservers': { displayName: localize('postgreSqlServers', 'PostgreSQL servers (Flexible)') },
    'microsoft.dbformysql/servers': { displayName: localize('mysqlServers', 'MySql servers') },
    'microsoft.sql/servers/databases': { displayName: localize('sqlDatabases', 'SQL databases') },
    'microsoft.sql/servers': { displayName: localize('sqlServers', 'SQL servers') },
    'microsoft.documentdb/databaseaccounts': { displayName: localize('documentDB', 'Azure Cosmos DB') },
    'microsoft.operationalinsights/workspaces': { displayName: localize('operationalInsightsWorkspaces', 'Operational Insights workspaces') },
    'microsoft.operationsmanagement/solutions': { displayName: localize('operationsManagementSolutions', 'Operations management solutions') },
    'microsoft.insights/components': { displayName: localize('insightsComponents', 'Application Insights') },
    'microsoft.web/serverfarms': { displayName: localize('serverFarms', 'App Service plans') },
    'microsoft.web/kubeenvironments': { displayName: localize('containerService', 'App Service Kubernetes Environment') },
    'microsoft.app/managedenvironments': { displayName: localize('containerAppsEnv', 'Container Apps Environment') },
    'microsoft.app/containerapps': { displayName: localize('containerApp', 'Container Apps') },
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
