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
        resourceGroup: { keyLabel: 'Resource Groups', label: getResourceGroupFromId(id), id: id.substring(0, id.indexOf('/providers')) },
        resourceType: {
            keyLabel: 'Resource Types', label: resource.type?.toLowerCase() ?? 'unknown',
            id: `${subscriptionId}/${resource.type}` ?? 'unknown',
            iconPath: getIconPath(resource?.type ?? 'resource')
        },
        location: {
            id: `${subscriptionId}/${resource.location}` ?? 'unknown',
            keyLabel: 'Location',
            label: resource.location ?? localize('unknown', 'Unknown'),
            icon: new ThemeIcon('globe')
        }
    }
}

export function getIconPath(type?: string): TreeItemIconPath {
    let iconName: string;
    const rType: string | undefined = type?.toLowerCase();
    if (rType && supportedIconTypes.includes(rType)) {
        iconName = rType;
        switch (rType) {
            case 'microsoft.web/sites':
                if (type?.toLowerCase().includes('functionapp')) {
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
export const supportedIconTypes: string[] = [
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
];
