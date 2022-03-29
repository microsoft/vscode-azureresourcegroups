/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GenericResource } from '@azure/arm-resources';
import { nonNullProp, TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import { ThemeIcon } from 'vscode';
import { GroupingConfig } from '../api';
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

export function getResourceGroupFromId(id: string): string {
    return parseResourceId(id)[2];
}

export function createGroupConfigFromResource(resource: GenericResource, subscriptionId: string | undefined): GroupingConfig {
    const id = nonNullProp(resource, 'id');
    return {
        resourceGroup: { keyLabel: 'Resource Groups', label: getResourceGroupFromId(id), id: id.substring(0, id.indexOf('/providers')).toLowerCase().replace('/resourcegroups', '/resourceGroups') },
        resourceType: {
            keyLabel: 'Resource Types',
            label: getName(resource) ?? resource.type ?? 'unknown',
            id: getId(subscriptionId, resource.type, resource.kind),
            iconPath: getIconPath(resource?.type ?? 'resource', resource.kind)
        },
        location: {
            id: `${subscriptionId}/${resource.location}` ?? 'unknown',
            keyLabel: 'Location',
            label: resource.location ?? localize('unknown', 'Unknown'),
            icon: new ThemeIcon('globe')
        }
    }
}

function getId(subscriptionId?: string, type?: string, kind?: string): string {
    if (type?.toLowerCase() === 'microsoft.web/sites') {
        if (kind?.toLowerCase() === 'functionapp') {
            return `${subscriptionId}/${kind}`;
        }
    }
    return `${subscriptionId}/${type}`;
}

export function getIconPath(type?: string, kind?: string): TreeItemIconPath {
    let iconName: string;
    const rType: string | undefined = type?.toLowerCase();
    if (rType && supportedIconTypes.includes(rType as SupportedTypes)) {
        iconName = rType;
        switch (rType) {
            case 'microsoft.web/sites':
                if (kind?.toLowerCase().includes('functionapp')) {
                    iconName = iconName.replace('sites', 'functionapp');
                }
                break;
            default:
        }
        iconName = path.join('providers', iconName);
    } else {
        iconName = 'resource';
    }

    return treeUtils.getIconPath(iconName);
}


// Execute `npm run listIcons` from root of repo to re-generate this list after adding an icon
export const supportedIconTypes = [
    'microsoft.web/functionapp',
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
    'microsoft.apimanagement/service',
] as const;

type SupportedTypes = typeof supportedIconTypes[number];

interface SupportedType {
    displayName: string;
}

function getName(resource: GenericResource): string | undefined {
    let type = resource.type?.toLowerCase();
    if (resource.type?.toLowerCase() === 'microsoft.web/sites') {
        if (resource.kind?.toLowerCase() === 'functionapp') {
            type = 'microsoft.web/functionapp';
        }
    }
    if (type) {
        return supportTypeInfo[type as SupportedTypes]?.displayName;
    }
    return undefined;
}

const supportTypeInfo: Partial<Record<SupportedTypes, SupportedType>> = {
    'microsoft.web/sites': { displayName: localize('webApp', 'App Services') },
    'microsoft.web/staticsites': { displayName: localize('staticWebApp', 'Static Web Apps') },
    'microsoft.web/functionapp': { displayName: localize('functionApp', 'Function App') },
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
    'microsoft.dbforpostgresql/servers': { displayName: localize('postgreSqlServers', 'PostgreSql servers') },
    'microsoft.dbformysql/servers': { displayName: localize('mysqlServers', 'MySql servers') },
    'microsoft.sql/servers/databases': { displayName: localize('sqlDatabases', 'SQL databases') },
    'microsoft.sql/servers': { displayName: localize('sqlServers', 'SQL servers') },
    'microsoft.documentdb/databaseaccounts': { displayName: localize('documentDB', 'Azure CosmosDB') },
    'microsoft.operationalinsights/workspaces': { displayName: localize('operationalInsightsWorkspaces', 'Operational Insights workspaces') },
    'microsoft.operationsmanagement/solutions': { displayName: localize('operationsManagementSolutions', 'Operations management solutions') },
    'microsoft.insights/components': { displayName: localize('insightsComponents', 'Application Insights') },
    'microsoft.web/serverfarms': { displayName: localize('serverFarms', 'App Service plans') },
    'microsoft.web/kubeenvironments': { displayName: localize('containerService', 'App Service Kubernetes Environment') },
}
