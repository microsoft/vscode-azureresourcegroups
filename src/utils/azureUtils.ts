/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceManagementClient } from '@azure/arm-resources';
import { getResourceGroupFromId, uiUtils } from '@microsoft/vscode-azext-azureutils';
import { AzExtResourceType, IActionContext, nonNullProp, TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import { AppResource, GroupingConfig, GroupNodeConfiguration } from '@microsoft/vscode-azext-utils/hostapi';
import * as path from 'path';
import { ThemeIcon } from 'vscode';
import type { IAzExtMetadata } from '../azureExtensions';
import { ext } from '../extensionVariables';
import { createResourceClient } from './azureClients';
import { localize } from './localize';
import { treeUtils } from './treeUtils';

export function createGroupConfigFromResource(resource: AppResource, subscriptionId: string | undefined): GroupingConfig {
    const id = nonNullProp(resource, 'id');
    const unknown = localize('unknown', 'Unknown');
    const groupConfig: GroupingConfig = {
        resourceGroup: {
            label: getResourceGroupFromId(id),
            id: id.substring(0, id.indexOf('/providers')).toLowerCase().replace('/resourcegroups', '/resourceGroups'),
            contextValuesToAdd: ['azureResourceGroup']
        },
        resourceType: {
            label: resource.azExtResourceType ? azExtDisplayInfo[resource.azExtResourceType ?? '']?.displayName ?? unknown : unknown,
            id: `${subscriptionId}/${resource.azExtResourceType}`,
            iconPath: getIconPath(resource.azExtResourceType),
            contextValuesToAdd: ['azureResourceTypeGroup', ...(resource.azExtResourceType ? [resource.azExtResourceType] : [])]
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
                contextValuesToAdd: ['azureResourceTypeGroup', azExtResourceType]
            });
        }
    }
    return azExtGroupConfigs;
}

export function getIconPath(azExtResourceType?: AzExtResourceType): TreeItemIconPath {
    return treeUtils.getIconPath(azExtResourceType ? path.join('azureIcons', azExtResourceType) : 'resource');
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

interface AzExtResourceTypeDisplayInfo {
    displayName: string;
}

export function getName(type?: string, kind?: string): string | undefined {
    type = type?.toLowerCase();
    if (isFunctionAppType(type, kind)) {
        type = 'microsoft.web/functionapp';
    }
    if (type) {
        return supportedTypes[type as SupportedTypes]?.displayName;
    }
    return undefined;
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

export function isFunctionAppType(type: string | undefined, kind: string | undefined): boolean {
    if (type?.toLowerCase() === 'microsoft.web/sites') {
        if (kind?.toLowerCase().includes('functionapp') && !kind?.toLowerCase().includes('workflowapp')) {
            return true;
        }
    }
    return false;
}

export function isFunctionApp(resource: GenericResource): boolean {
    const { type, kind } = resource;

    return isFunctionAppType(type, kind);
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
