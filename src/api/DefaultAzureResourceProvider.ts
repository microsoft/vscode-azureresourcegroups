/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GenericResource, ResourceGroup } from '@azure/arm-resources';
import { getResourceGroupFromId } from "@microsoft/vscode-azext-azureutils";
import { IActionContext, callWithTelemetryAndErrorHandling, getAzExtResourceType, nonNullProp } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { AzureResource, AzureSubscription } from '../../api/src/index';
import { AzureResourceProvider } from '../hostapi.v2.internal';
import { getAzureResourcesService } from '../services/AzureResourcesService';

export class DefaultAzureResourceProvider implements AzureResourceProvider {
    private readonly onDidChangeResourceEmitter = new vscode.EventEmitter<AzureResource | undefined>();

    getResources(subscription: AzureSubscription): Promise<AzureResource[] | undefined> {
        return callWithTelemetryAndErrorHandling(
            'defaultAzureResourceProvider.getResources',
            async (context: IActionContext) => {
                const azureResources = await this.listResources(context, subscription);
                const resourceGroups = await this.listResourceGroups(context, subscription);
                return [...azureResources, ...resourceGroups];
            });
    }

    onDidChangeResource = this.onDidChangeResourceEmitter.event;

    /**
     * @returns Deduped list of Azure resources in the specified subscription
     */
    private async listResources(context: IActionContext, subscription: AzureSubscription): Promise<AzureResource[]> {
        const allResources = await getAzureResourcesService().listResources(context, subscription);

        // dedupe resources to fix https://github.com/microsoft/vscode-azureresourcegroups/issues/526
        const allResourcesDeduped: GenericResource[] = [...new Map(allResources.map((item) => [item.id, item])).values()];
        context.telemetry.measurements.resourceCount = allResourcesDeduped.length;

        if (allResourcesDeduped.length !== allResources.length) {
            context.telemetry.properties.duplicateResources = 'true';
            context.telemetry.measurements.rawResourceCount = allResources.length;
        }

        return allResourcesDeduped.map(resource => createAzureResource(subscription, resource));
    }

    private async listResourceGroups(context: IActionContext, subscription: AzureSubscription): Promise<AzureResource[]> {
        const allResourceGroups: ResourceGroup[] = await getAzureResourcesService().listResourceGroups(context, subscription);
        context.telemetry.measurements.resourceGroupCount = allResourceGroups.length;
        return allResourceGroups.map(resource => createResourceGroup(subscription, resource));
    }
}

function createAzureResource(subscription: AzureSubscription, resource: GenericResource): AzureResource {
    const resourceId = nonNullProp(resource, 'id');

    return {
        ...resource,
        subscription,
        id: resourceId,
        name: nonNullProp(resource, 'name'),
        azureResourceType: {
            type: nonNullProp(resource, 'type').toLowerCase(),
            kinds: resource.kind?.split(',')?.map(kind => kind.toLowerCase()),
        },
        resourceGroup: getResourceGroupFromId(resourceId),
        location: resource.location,
        resourceType: getAzExtResourceType({
            type: nonNullProp(resource, 'type'),
            kind: resource.kind
        }),
        raw: resource,
    };
}



export function createResourceGroup(subscription: AzureSubscription, resourceGroup: ResourceGroup): AzureResource {
    return {
        ...resourceGroup,
        subscription,
        id: nonNullProp(resourceGroup, 'id'),
        name: nonNullProp(resourceGroup, 'name'),
        azureResourceType: {
            type: nonNullProp(resourceGroup, 'type').toLowerCase()
        },
        raw: resourceGroup,
    };
}
