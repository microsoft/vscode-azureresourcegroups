/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GenericResource, ResourceGroup } from '@azure/arm-resources';
import { getResourceGroupFromId, uiUtils } from "@microsoft/vscode-azext-azureutils";
import { callWithTelemetryAndErrorHandling, getAzExtResourceType, IActionContext, nonNullProp } from '@microsoft/vscode-azext-utils';
import { AzureResource, AzureSubscription } from '@microsoft/vscode-azext-utils/hostapi.v2';
import * as vscode from 'vscode';
import { AzureResourceProvider } from '../../hostapi.v2.internal';
import { createResourceClient } from '../utils/azureClients';
import { createSubscriptionContext } from '../utils/v2/credentialsUtils';

export class DefaultAzureResourceProvider implements AzureResourceProvider {
    private readonly onDidChangeResourceEmitter = new vscode.EventEmitter<AzureResource | undefined>();

    getResources(subscription: AzureSubscription): Promise<AzureResource[] | undefined> {
        return callWithTelemetryAndErrorHandling(
            'defaultAzureResourceProvider.getResources',
            async (context: IActionContext) => {
                const azureResources = await listResources(context, subscription);
                const resourceGroups = await listResourceGroups(context, subscription);
                return [...azureResources, ...resourceGroups];
            });
    }

    onDidChangeResource = this.onDidChangeResourceEmitter.event;
}

/**
 * @returns Deduped list of Azure resources in the specified subscription
 */
async function listResources(context: IActionContext, subscription: AzureSubscription): Promise<AzureResource[]> {
    const subContext = createSubscriptionContext(subscription);
    const client = await createResourceClient([context, subContext]);

    // Load more currently broken https://github.com/Azure/azure-sdk-for-js/issues/20380
    const allResources = await uiUtils.listAllIterator(client.resources.list());

    // dedupe resources to fix https://github.com/microsoft/vscode-azureresourcegroups/issues/526
    const allResourcesDeduped: GenericResource[] = [...new Map(allResources.map((item) => [item.id, item])).values()];
    context.telemetry.measurements.resourceCount = allResourcesDeduped.length;

    if (allResourcesDeduped.length !== allResources.length) {
        context.telemetry.properties.duplicateResources = 'true';
        context.telemetry.measurements.rawResourceCount = allResources.length;
    }

    return allResourcesDeduped.map(resource => createAzureResource(subscription, resource));
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

async function listResourceGroups(context: IActionContext, subscription: AzureSubscription): Promise<AzureResource[]> {
    const subContext = createSubscriptionContext(subscription);
    const client = await createResourceClient([context, subContext]);

    const allResourceGroups: ResourceGroup[] = await uiUtils.listAllIterator(client.resourceGroups.list());
    context.telemetry.measurements.resourceGroupCount = allResourceGroups.length;

    return allResourceGroups.map(resource => createResourceGroup(subscription, resource));
}

function createResourceGroup(subscription: AzureSubscription, resourceGroup: ResourceGroup): AzureResource {
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
