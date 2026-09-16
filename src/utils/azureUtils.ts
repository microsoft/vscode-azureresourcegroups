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
import { getName } from './azExtResourceTypeDisplayName';
import { localize } from './localize';
import { treeUtils } from './treeUtils';

export function validateResourceGroupId(resourceGroupId: string): void {
    const match = resourceGroupId.match(/^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+$/i);
    if (!match) {
        throw new Error(`Invalid resource group ID format: ${resourceGroupId}. Expected format: /subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}`);
    }
}

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
            label: resource.azExtResourceType ? getName(resource.azExtResourceType) ?? resource.azExtResourceType : unknown,
            id: `${subscriptionId}/${resource.azExtResourceType}`,
            iconPath,
            contextValuesToAdd: ['azureResourceTypeGroup', ...(resource.azExtResourceType ? [resource.azExtResourceType, legacyTypeMap[resource.azExtResourceType] ?? ''] : [])]
        },
        location: {
            id: `${subscriptionId}/location/${resource.location}`,
            label: resource.location ?? unknown,
            icon: new ThemeIcon('globe'),
            contextValuesToAdd: ['azureLocationGroup']
        }
    };

    if (resource.tags) {
        for (const tag of Object.keys(resource.tags)) {
            groupConfig[`armTag-${tag}`] = {
                label: resource.tags[tag],
                id: `${subscriptionId}/${tag}/${resource.tags[tag]}`,
                icon: new ThemeIcon('tag')
            };
        }
    }

    return groupConfig;
}

export function createAzureExtensionsGroupConfig(extensions: IAzExtMetadata[], subscriptionId: string): GroupNodeConfiguration[] {
    const azExtGroupConfigs: GroupNodeConfiguration[] = [];
    for (const azExt of extensions) {
        for (const azExtResourceType of azExt.resourceTypes) {
            azExtGroupConfigs.push({
                label: getName(azExtResourceType) ?? azExtResourceType,
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

export { getName };
