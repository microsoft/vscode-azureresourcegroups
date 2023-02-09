/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { GenericResource, ResourceGroup } from "@azure/arm-resources";
import { randomUUID } from "crypto";
import { AzureResourcesService, AzureResourcesServiceFactory } from "../../extension.bundle";

export const mockAzureResourcesServiceFactory: AzureResourcesServiceFactory = (): AzureResourcesService => {
    let rgCount = 0;
    function rg(): ResourceGroup {
        rgCount++;
        return {
            location: 'MockLocation',
            name: `mock-rg-${rgCount}`,
            id: `/subscriptions/${randomUUID()}/resourceGroups/mock-rg-${rgCount}`,
            type: 'resourceGroup',
        }
    }

    function func(resourceGroup: ResourceGroup, name: string): GenericResource {
        return {
            id: `${resourceGroup.id}/providers/Microsoft.Web/sites/${name}`,
            name,
            type: 'microsoft.web/sites',
            kind: 'functionapp',
        }
    }

    const resourceGroups: ResourceGroup[] = [
        rg()
    ];

    const resources: GenericResource[] = [
        func(resourceGroups[0], 'my-functionapp-1'),
        func(resourceGroups[0], 'my-functionapp-2'),
        func(resourceGroups[0], 'my-functionapp-3'),
    ];

    return {
        async listResources(): Promise<GenericResource[]> {
            return resources;
        },
        async listResourceGroups(): Promise<ResourceGroup[]> {
            return resourceGroups;
        },
    }
}
