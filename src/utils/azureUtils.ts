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

interface AzExtResourceTypeDisplayInfo {
    displayName: string;
}

const azExtDisplayInfo: Partial<Record<AzExtResourceType, AzExtResourceTypeDisplayInfo>> = {
    'ApplicationInsights': { displayName: localize('insightsComponents', 'Application Insights') },
    'AppServiceKubernetesEnvironment': { displayName: localize('containerService', 'App Service Kubernetes Environment') },
    'AppServicePlans': { displayName: localize('serverFarms', 'App Service plans') },
    'AppServices': { displayName: localize('webApp', 'App Services') },
    'AvailabilitySets': { displayName: localize('availabilitySets', 'Availability sets') },
    'AzureCosmosDb': { displayName: localize('documentDB', 'Azure Cosmos DB') },
    'BatchAccounts': { displayName: localize('batchAccounts', 'Batch accounts') },
    'ContainerApps': { displayName: localize('containerApp', 'Container Apps') },
    'ContainerAppsEnvironment': { displayName: localize('containerAppsEnv', 'Container Apps Environment') },
    'ContainerRegistry': { displayName: localize('containerRegistry', 'Container registry') },
    'Disks': { displayName: localize('disks', 'Disks') },
    'FrontDoorAndCdnProfiles': { displayName: localize('frontDoorAndcdnProfiles', 'Front Door and CDN profiles') },
    'FunctionApp': { displayName: localize('functionApp', 'Function App') },
    'Images': { displayName: localize('images', 'Images') },
    'LoadBalancers': { displayName: localize('loadBalancers', 'Load balancers') },
    'LogicApp': { displayName: localize('logicApp', 'Logic App') },
    'MysqlServers': { displayName: localize('mysqlServers', 'MySql servers') },
    'NetworkInterfaces': { displayName: localize('networkInterfaces', 'Network interfaces') },
    'NetworkSecurityGroups': { displayName: localize('networkSecurityGroups', 'Network security groups') },
    'NetworkWatchers': { displayName: localize('networkWatchers', 'Network watchers') },
    'OperationalInsightsWorkspaces': { displayName: localize('operationalInsightsWorkspaces', 'Operational Insights workspaces') },
    'OperationsManagementSolutions': { displayName: localize('operationsManagementSolutions', 'Operations management solutions') },
    'PostgresqlServersFlexible': { displayName: localize('postgreSqlServers', 'PostgreSQL servers (Flexible)') },
    'PostgresqlServersStandard': { displayName: localize('postgreSqlServers', 'PostgreSQL servers (Standard)') },
    'PublicIpAddresses': { displayName: localize('publicIpAddresses', 'Public IP addresses') },
    'SqlDatabases': { displayName: localize('sqlDatabases', 'SQL databases') },
    'SqlServers': { displayName: localize('sqlServers', 'SQL servers') },
    'StaticWebApps': { displayName: localize('staticWebApp', 'Static Web Apps') },
    'StorageAccounts': { displayName: localize('storageAccounts', 'Storage accounts') },
    'VirtualMachines': { displayName: localize('virtualMachines', 'Virtual machines') },
    'VirtualMachineScaleSets': { displayName: localize('virtualMachineScaleSets', 'Virtual machine scale sets') },
    'VirtualNetworks': { displayName: localize('virtualNetworks', 'Virtual networks') },
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
